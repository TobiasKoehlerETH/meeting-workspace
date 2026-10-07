# Local speech runtime

Required license texts are included in this directory.

- sherpa-onnx: https://github.com/k2-fsa/sherpa-onnx
- ONNX Runtime: https://github.com/microsoft/onnxruntime

Speech model weights download separately to the user's application data directory.
Model weights retain their respective NVIDIA licenses.

## Bundled speaker detection

- sherpa-onnx v1.13.8 native CPU runtime: Apache-2.0; see SHERPA-ONNX-LICENSE.txt.
- ONNX Runtime: MIT; see ONNX-RUNTIME-LICENSE.txt.
- pyannote segmentation-3.0, exported and quantized to ONNX by sherpa-onnx: MIT, copyright CNRS; see PYANNOTE-SEGMENTATION-LICENSE.txt.
- NVIDIA NeMo TitaNet-S speaker embeddings, exported to ONNX by sherpa-onnx: Apache-2.0; see NVIDIA-NEMO-LICENSE.txt. Model source: https://catalog.ngc.nvidia.com/orgs/nvidia/teams/nemo/models/titanet_small.

Speaker models are bundled in speaker-runtime and run offline. Pinned upstream URLs and checksums are recorded in scripts/prepare-speaker-runtime.py. These models group voices; they do not establish a person's identity.
