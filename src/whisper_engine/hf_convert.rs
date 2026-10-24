//! Converts a Hugging Face Whisper checkpoint (safetensors) into a whisper.cpp model file.
//!
//! The output matches whisper.cpp's `convert-h5-to-ggml.py` followed by `whisper-quantize q5_0`.
//! Hyperparameters, mel filters and vocabulary come from a reference whisper.cpp file of the same
//! architecture (fine-tunes keep them), so no Python or tokenizer code is needed at runtime.

use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::Path;

use anyhow::{anyhow, bail, Context, Result};
use half::f16;

const GGML_MAGIC: u32 = 0x6767_6d6c;
const FTYPE_F16: i32 = 1;
/// `GGML_QNT_VERSION (2) * GGML_QNT_VERSION_FACTOR (1000) + GGML_FTYPE_MOSTLY_Q5_0 (8)`
const FTYPE_Q5_0: i32 = 2008;
const TYPE_F32: i32 = 0;
const TYPE_F16: i32 = 1;
const TYPE_Q5_0: i32 = 6;
const QK5_0: usize = 32;

/// Tensors whisper.cpp keeps in f32; the quantizer skips them too.
const F32_TENSORS: [&str; 4] = [
    "encoder.conv1.bias", "encoder.conv2.bias", "encoder.positional_embedding", "decoder.positional_embedding",
];

const TOP_LEVEL_NAMES: [(&str, &str); 7] = [
    ("encoder.layer_norm.bias", "encoder.ln_post.bias"),
    ("encoder.layer_norm.weight", "encoder.ln_post.weight"),
    ("encoder.embed_positions.weight", "encoder.positional_embedding"),
    ("decoder.layer_norm.bias", "decoder.ln.bias"),
    ("decoder.layer_norm.weight", "decoder.ln.weight"),
    ("decoder.embed_positions.weight", "decoder.positional_embedding"),
    ("decoder.embed_tokens.weight", "decoder.token_embedding.weight"),
];

const LAYER_NAMES: [(&str, &str); 13] = [
    ("self_attn.k_proj", "attn.key"),
    ("self_attn.q_proj", "attn.query"),
    ("self_attn.v_proj", "attn.value"),
    ("self_attn.out_proj", "attn.out"),
    ("self_attn_layer_norm", "attn_ln"),
    ("encoder_attn.k_proj", "cross_attn.key"),
    ("encoder_attn.q_proj", "cross_attn.query"),
    ("encoder_attn.v_proj", "cross_attn.value"),
    ("encoder_attn.out_proj", "cross_attn.out"),
    ("encoder_attn_layer_norm", "cross_attn_ln"),
    ("fc1", "mlp.0"),
    ("fc2", "mlp.2"),
    ("final_layer_norm", "mlp_ln"),
];

/// The part of a whisper.cpp file before its first tensor.
pub struct ReferenceHeader {
    /// n_vocab, n_audio_ctx, n_audio_state, n_audio_head, n_audio_layer,
    /// n_text_ctx, n_text_state, n_text_head, n_text_layer, n_mels, ftype
    hparams: [i32; 11],
    filters_and_vocab: Vec<u8>,
}

impl ReferenceHeader {
    /// Parses the start of a whisper.cpp file; trailing tensor bytes are ignored.
    pub fn parse(bytes: &[u8]) -> Result<Self> {
        let mut at = 0;
        if read_i32(bytes, &mut at)? as u32 != GGML_MAGIC {
            bail!("reference file is not a whisper.cpp model");
        }
        let mut hparams = [0; 11];
        for value in &mut hparams {
            *value = read_i32(bytes, &mut at)?;
        }
        let start = at;
        let n_mel = read_len(bytes, &mut at)?;
        let n_fft = read_len(bytes, &mut at)?;
        skip(bytes, &mut at, n_mel * n_fft * 4)?;
        for _ in 0..read_len(bytes, &mut at)? {
            let len = read_len(bytes, &mut at)?;
            skip(bytes, &mut at, len)?;
        }
        Ok(Self { hparams, filters_and_vocab: bytes[start..at].to_vec() })
    }
}

fn read_i32(bytes: &[u8], at: &mut usize) -> Result<i32> {
    let value = bytes.get(*at..*at + 4).ok_or_else(|| anyhow!("reference header is truncated"))?;
    *at += 4;
    Ok(i32::from_le_bytes(value.try_into().unwrap()))
}

fn read_len(bytes: &[u8], at: &mut usize) -> Result<usize> {
    usize::try_from(read_i32(bytes, at)?).map_err(|_| anyhow!("reference header has a negative length"))
}

fn skip(bytes: &[u8], at: &mut usize, len: usize) -> Result<()> {
    if bytes.len() < *at + len {
        bail!("reference header is truncated");
    }
    *at += len;
    Ok(())
}

#[derive(Clone, Copy)]
enum Dtype { F16, Bf16, F32 }

impl Dtype {
    fn size(self) -> usize {
        match self { Self::F16 | Self::Bf16 => 2, Self::F32 => 4 }
    }

    fn decode(self, bytes: &[u8], out: &mut Vec<f32>) {
        out.clear();
        out.extend(bytes.chunks_exact(self.size()).map(|b| match self {
            Self::F16 => f16::from_le_bytes([b[0], b[1]]).to_f32(),
            Self::Bf16 => half::bf16::from_le_bytes([b[0], b[1]]).to_f32(),
            // The reference converter rounds every weight through f16 first.
            Self::F32 => f16::from_f32(f32::from_le_bytes([b[0], b[1], b[2], b[3]])).to_f32(),
        }));
    }
}

struct Tensor { name: String, shape: Vec<usize>, dtype: Dtype, offset: u64 }

/// whisper.cpp's name for a Hugging Face tensor, or None for tensors whisper.cpp does not load.
fn ggml_name(hf_name: &str) -> Result<Option<String>> {
    // proj_out is tied to the token embedding.
    let Some(name) = hf_name.strip_prefix("model.") else { return Ok(None) };
    let parts: Vec<&str> = name.split('.').collect();
    if parts.len() >= 5 && parts[1] == "layers" {
        let module = parts[3..parts.len() - 1].join(".");
        let (_, mapped) = LAYER_NAMES.iter().find(|(hf, _)| *hf == module)
            .ok_or_else(|| anyhow!("unexpected tensor {hf_name}"))?;
        return Ok(Some(format!("{}.blocks.{}.{}.{}", parts[0], parts[2], mapped, parts[parts.len() - 1])));
    }
    Ok(Some(TOP_LEVEL_NAMES.iter().find(|(hf, _)| *hf == name).map_or(name, |(_, mapped)| mapped).to_string()))
}

fn read_tensors(file: &mut BufReader<File>) -> Result<Vec<Tensor>> {
    let mut len = [0; 8];
    file.read_exact(&mut len)?;
    let len = u64::from_le_bytes(len);
    if len > 100_000_000 {
        bail!("safetensors header is implausibly large");
    }
    let mut header = vec![0; len as usize];
    file.read_exact(&mut header)?;
    let header: serde_json::Map<String, serde_json::Value> = serde_json::from_slice(&header)
        .context("safetensors header is not valid JSON")?;
    let mut tensors = Vec::new();
    for (name, info) in header {
        if name == "__metadata__" {
            continue;
        }
        let dtype = match info["dtype"].as_str() {
            Some("F16") => Dtype::F16,
            Some("BF16") => Dtype::Bf16,
            Some("F32") => Dtype::F32,
            other => bail!("tensor {name} has unsupported dtype {other:?}"),
        };
        let shape: Vec<usize> = info["shape"].as_array().into_iter().flatten()
            .map(|dim| dim.as_u64().map(|dim| dim as usize)).collect::<Option<_>>()
            .ok_or_else(|| anyhow!("tensor {name} has an invalid shape"))?;
        let (start, end) = match info["data_offsets"].as_array().map(Vec::as_slice) {
            Some([start, end]) => (start.as_u64(), end.as_u64()),
            _ => (None, None),
        };
        let (Some(start), Some(end)) = (start, end) else { bail!("tensor {name} has invalid offsets") };
        if end - start != (shape.iter().product::<usize>() * dtype.size()) as u64 {
            bail!("tensor {name} size does not match its shape");
        }
        tensors.push(Tensor { name, shape, dtype, offset: 8 + len + start });
    }
    tensors.sort_by_key(|tensor| tensor.offset);
    Ok(tensors)
}

/// Checks that the reference header describes the checkpoint's architecture.
fn check_architecture(hparams: &[i32; 11], tensors: &[(String, &Tensor)]) -> Result<()> {
    let shape = |name: &str| tensors.iter().find(|(n, _)| n == name).map(|(_, t)| t.shape.clone())
        .ok_or_else(|| anyhow!("checkpoint has no {name}"));
    let layers = |prefix: &str| tensors.iter().filter(|(n, _)| n.starts_with(prefix) && n.ends_with(".mlp_ln.weight")).count();
    let h = |i: usize| hparams[i] as usize;
    let matches = shape("decoder.token_embedding.weight")? == [h(0), h(6)]
        && shape("encoder.positional_embedding")? == [h(1), h(2)]
        && shape("decoder.positional_embedding")? == [h(5), h(6)]
        && shape("encoder.conv1.weight")? == [h(2), h(9), 3]
        && layers("encoder.blocks.") == h(4)
        && layers("decoder.blocks.") == h(8);
    if !matches {
        bail!("checkpoint architecture does not match the reference model");
    }
    Ok(())
}

/// Writes `checkpoint` as a whisper.cpp model: q5_0 when `quantize`, else f16.
/// `progress` receives 0.0..=1.0; returning false from `keep_going` stops the conversion.
pub fn convert(
    checkpoint: &Path,
    reference: &ReferenceHeader,
    output: &Path,
    quantize: bool,
    progress: &mut dyn FnMut(f32),
    keep_going: &dyn Fn() -> bool,
) -> Result<()> {
    let mut input = BufReader::with_capacity(1 << 20, File::open(checkpoint).context("cannot open checkpoint")?);
    let tensors = read_tensors(&mut input)?;
    let mut named = Vec::new();
    for tensor in &tensors {
        if let Some(name) = ggml_name(&tensor.name)? {
            named.push((name, tensor));
        }
    }
    check_architecture(&reference.hparams, &named)?;

    let mut out = BufWriter::with_capacity(1 << 20, File::create(output).context("cannot create model file")?);
    out.write_all(&GGML_MAGIC.to_le_bytes())?;
    for value in &reference.hparams[..10] {
        out.write_all(&value.to_le_bytes())?;
    }
    out.write_all(&(if quantize { FTYPE_Q5_0 } else { FTYPE_F16 }).to_le_bytes())?;
    out.write_all(&reference.filters_and_vocab)?;

    let total: usize = named.iter().map(|(_, t)| t.shape.iter().product::<usize>()).sum();
    let (mut done, mut raw, mut row, mut encoded) = (0, Vec::new(), Vec::new(), Vec::new());
    for (name, tensor) in &named {
        if !keep_going() {
            bail!("conversion cancelled");
        }
        let mut shape: Vec<usize> = tensor.shape.iter().copied().filter(|&dim| dim != 1).collect();
        if name.starts_with("encoder.conv") && name.ends_with(".bias") {
            shape.push(1);
        }
        let f32_tensor = shape.len() < 2 || F32_TENSORS.contains(&name.as_str());
        let ttype = if f32_tensor { TYPE_F32 } else if quantize && shape.len() == 2 { TYPE_Q5_0 } else { TYPE_F16 };
        let Some(&row_len) = shape.last() else { bail!("tensor {name} is a scalar") };
        if ttype == TYPE_Q5_0 && row_len % QK5_0 != 0 {
            bail!("tensor {name} rows cannot be quantized");
        }

        out.write_all(&(shape.len() as i32).to_le_bytes())?;
        out.write_all(&(name.len() as i32).to_le_bytes())?;
        out.write_all(&ttype.to_le_bytes())?;
        for dim in shape.iter().rev() {
            out.write_all(&(*dim as i32).to_le_bytes())?;
        }
        out.write_all(name.as_bytes())?;

        input.seek(SeekFrom::Start(tensor.offset))?;
        let elements: usize = shape.iter().product();
        raw.resize(row_len * tensor.dtype.size(), 0);
        for _ in 0..elements / row_len {
            input.read_exact(&mut raw)?;
            tensor.dtype.decode(&raw, &mut row);
            encoded.clear();
            match ttype {
                TYPE_F32 => row.iter().for_each(|v| encoded.extend_from_slice(&v.to_le_bytes())),
                TYPE_F16 => row.iter().for_each(|v| encoded.extend_from_slice(&f16::from_f32(*v).to_le_bytes())),
                _ => quantize_q5_0(&row, &mut encoded),
            }
            out.write_all(&encoded)?;
        }
        done += elements;
        progress(done as f32 / total as f32);
    }
    out.into_inner().map_err(|error| error.into_error())?.sync_all()?;
    Ok(())
}

/// ggml's `quantize_row_q5_0_ref`: per 32 values an f16 scale, the fifth bits, then nibbles.
fn quantize_q5_0(values: &[f32], out: &mut Vec<u8>) {
    for block in values.chunks_exact(QK5_0) {
        let (mut amax, mut max) = (0.0f32, 0.0f32);
        for &value in block {
            if amax < value.abs() {
                amax = value.abs();
                max = value;
            }
        }
        let d = max / -16.0;
        let id = if d != 0.0 { 1.0 / d } else { 0.0 };
        let mut qh = 0u32;
        let mut qs = [0u8; QK5_0 / 2];
        for j in 0..QK5_0 / 2 {
            let q0 = ((block[j] * id + 16.5) as i8).min(31) as u8;
            let q1 = ((block[j + QK5_0 / 2] * id + 16.5) as i8).min(31) as u8;
            qs[j] = (q0 & 0x0f) | ((q1 & 0x0f) << 4);
            qh |= ((q0 as u32 & 0x10) >> 4) << j;
            qh |= ((q1 as u32 & 0x10) >> 4) << (j + QK5_0 / 2);
        }
        out.extend_from_slice(&f16::from_f32(d).to_le_bytes());
        out.extend_from_slice(&qh.to_le_bytes());
        out.extend_from_slice(&qs);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dequantize_q5_0(block: &[u8]) -> Vec<f32> {
        let d = f16::from_le_bytes([block[0], block[1]]).to_f32();
        let qh = u32::from_le_bytes(block[2..6].try_into().unwrap());
        let mut values = vec![0.0; QK5_0];
        for j in 0..QK5_0 / 2 {
            let high0 = ((qh >> j) & 1) << 4;
            let high1 = ((qh >> (j + 16)) & 1) << 4;
            values[j] = (((block[6 + j] & 0x0f) as u32 | high0) as f32 - 16.0) * d;
            values[j + 16] = (((block[6 + j] >> 4) as u32 | high1) as f32 - 16.0) * d;
        }
        values
    }

    #[test]
    fn maps_hugging_face_names_to_whisper_cpp() {
        let cases = [
            ("model.encoder.layers.3.self_attn.k_proj.weight", Some("encoder.blocks.3.attn.key.weight")),
            ("model.decoder.layers.0.encoder_attn.k_proj.weight", Some("decoder.blocks.0.cross_attn.key.weight")),
            ("model.decoder.layers.1.fc2.bias", Some("decoder.blocks.1.mlp.2.bias")),
            ("model.decoder.embed_tokens.weight", Some("decoder.token_embedding.weight")),
            ("model.encoder.conv1.weight", Some("encoder.conv1.weight")),
            ("proj_out.weight", None),
        ];
        for (hf, expected) in cases {
            assert_eq!(ggml_name(hf).unwrap().as_deref(), expected);
        }
        assert!(ggml_name("model.encoder.layers.0.unknown.weight").is_err());
    }

    #[test]
    fn q5_0_matches_the_ggml_reference_layout() {
        let mut block = [0.0f32; QK5_0];
        block[0] = -16.0;
        block[17] = 8.0;
        let mut out = Vec::new();
        quantize_q5_0(&block, &mut out);
        assert_eq!(out.len(), 22);
        assert_eq!(f16::from_le_bytes([out[0], out[1]]).to_f32(), 1.0);
        // -16 → 0, 0 → 16 (fifth bit set), 8 → 24 (fifth bit set)
        assert_eq!(u32::from_le_bytes(out[2..6].try_into().unwrap()), !1);
        assert_eq!(out[6], 0x00);
        assert_eq!(out[7], 0x80);
        assert_eq!(dequantize_q5_0(&out), block);
    }

    #[test]
    fn q5_0_round_trip_stays_within_one_step() {
        let block: Vec<f32> = (0..QK5_0).map(|i| ((i * 37 % 29) as f32 - 14.0) * 0.013).collect();
        let mut out = Vec::new();
        quantize_q5_0(&block, &mut out);
        let step = f16::from_le_bytes([out[0], out[1]]).to_f32().abs();
        for (original, restored) in block.iter().zip(dequantize_q5_0(&out)) {
            // Half a step, except the opposite extreme, which clamps to the top code.
            assert!((original - restored).abs() <= step + 1e-6);
        }
    }

    fn reference_bytes(hparams: [i32; 11]) -> Vec<u8> {
        let mut bytes = GGML_MAGIC.to_le_bytes().to_vec();
        hparams.iter().for_each(|v| bytes.extend_from_slice(&v.to_le_bytes()));
        [2i32, 3].iter().for_each(|v| bytes.extend_from_slice(&v.to_le_bytes()));
        (0..6).for_each(|i| bytes.extend_from_slice(&(i as f32).to_le_bytes()));
        bytes.extend_from_slice(&2i32.to_le_bytes());
        for token in [&b"a"[..], b"bc"] {
            bytes.extend_from_slice(&(token.len() as i32).to_le_bytes());
            bytes.extend_from_slice(token);
        }
        bytes
    }

    #[test]
    fn reference_header_stops_before_the_first_tensor() {
        let mut bytes = reference_bytes([64, 8, 32, 1, 0, 6, 32, 1, 0, 2, 1]);
        let header_len = bytes.len();
        bytes.extend_from_slice(&[9; 16]);
        let header = ReferenceHeader::parse(&bytes).unwrap();
        assert_eq!(header.hparams[0], 64);
        assert_eq!(header.filters_and_vocab, bytes[48..header_len]);
        assert!(ReferenceHeader::parse(&bytes[..header_len - 1]).is_err());
    }

    #[test]
    fn converts_a_tiny_checkpoint() {
        let dir = tempfile::tempdir().unwrap();
        let tensors: [(&str, Vec<usize>); 5] = [
            ("model.decoder.embed_tokens.weight", vec![64, 32]),
            ("model.decoder.embed_positions.weight", vec![6, 32]),
            ("model.encoder.embed_positions.weight", vec![8, 32]),
            ("model.encoder.conv1.weight", vec![32, 2, 3]),
            ("model.encoder.conv1.bias", vec![32]),
        ];
        let (mut header, mut data) = (serde_json::Map::new(), Vec::new());
        for (name, shape) in &tensors {
            let start = data.len();
            for i in 0..shape.iter().product::<usize>() {
                data.extend_from_slice(&f16::from_f32((i % 7) as f32 * 0.25 - 0.5).to_le_bytes());
            }
            header.insert(name.to_string(), serde_json::json!({ "dtype": "F16", "shape": shape, "data_offsets": [start, data.len()] }));
        }
        let header = serde_json::to_vec(&header).unwrap();
        let checkpoint = dir.path().join("model.safetensors");
        let mut file = (header.len() as u64).to_le_bytes().to_vec();
        file.extend_from_slice(&header);
        file.extend_from_slice(&data);
        std::fs::write(&checkpoint, file).unwrap();

        let reference = ReferenceHeader::parse(&reference_bytes([64, 8, 32, 1, 0, 6, 32, 1, 0, 2, 1])).unwrap();
        let output = dir.path().join("ggml.bin");
        let mut last = 0.0;
        convert(&checkpoint, &reference, &output, true, &mut |p| last = p, &|| true).unwrap();
        assert_eq!(last, 1.0);

        let bytes = std::fs::read(&output).unwrap();
        assert_eq!(i32::from_le_bytes(bytes[44..48].try_into().unwrap()), FTYPE_Q5_0);
        let mut at = 48 + reference.filters_and_vocab.len();
        let mut seen = Vec::new();
        while at < bytes.len() {
            let n_dims = read_len(&bytes, &mut at).unwrap();
            let name_len = read_len(&bytes, &mut at).unwrap();
            let ttype = read_i32(&bytes, &mut at).unwrap();
            let dims: Vec<usize> = (0..n_dims).map(|_| read_len(&bytes, &mut at).unwrap()).collect();
            let name = String::from_utf8(bytes[at..at + name_len].to_vec()).unwrap();
            at += name_len;
            let elements: usize = dims.iter().product();
            at += match ttype { TYPE_F32 => elements * 4, TYPE_F16 => elements * 2, _ => elements / QK5_0 * 22 };
            seen.push((name, ttype, dims));
        }
        assert_eq!(at, bytes.len());
        assert_eq!(seen, [
            ("decoder.token_embedding.weight".to_string(), TYPE_Q5_0, vec![32, 64]),
            ("decoder.positional_embedding".to_string(), TYPE_F32, vec![32, 6]),
            ("encoder.positional_embedding".to_string(), TYPE_F32, vec![32, 8]),
            ("encoder.conv1.weight".to_string(), TYPE_F16, vec![3, 2, 32]),
            ("encoder.conv1.bias".to_string(), TYPE_F32, vec![1, 32]),
        ]);
    }
}
