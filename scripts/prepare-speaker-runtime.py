"""Stage the pinned native Windows diarization runtime and its local models."""

import hashlib
from pathlib import Path
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / '.build-tools' / 'speakers'
OUTPUT = ROOT / 'src-tauri' / 'speaker-runtime'
VERSION = 'v1.13.8'


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    runtime = download('runtime.tar.bz2',
        f'https://github.com/k2-fsa/sherpa-onnx/releases/download/{VERSION}/sherpa-onnx-{VERSION}-win-x64-shared-MD-Release-no-tts.tar.bz2',
        '876e6b89b8cf84a3a1b375a397507f2cfe9c227c2a945411a11a668475fcb5d3')
    prefix = f'sherpa-onnx-{VERSION}-win-x64-shared-MD-Release-no-tts/bin/'
    with tarfile.open(runtime) as archive:
        for name in ['sherpa-onnx-offline-speaker-diarization.exe', 'onnxruntime.dll', 'onnxruntime_providers_shared.dll']:
            stage(name, archive.extractfile(prefix + name).read())
    segmentation = download('segmentation.tar.bz2',
        'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2',
        '24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488')
    with tarfile.open(segmentation) as archive:
        prefix = 'sherpa-onnx-pyannote-segmentation-3-0/'
        stage('segmentation.onnx', archive.extractfile(prefix + 'model.int8.onnx').read())
        stage('segmentation-LICENSE', archive.extractfile(prefix + 'LICENSE').read())
    embedding = download('embedding.onnx',
        'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/nemo_en_titanet_small.onnx',
        'ad4a1802485d8b34c722d2a9d04249662f2ece5d28a7a039063ca22f515a789e')
    stage('embedding.onnx', embedding.read_bytes())
    print(f'Local speaker models and native runtime staged in {OUTPUT}')


def download(name, url, expected):
    path = CACHE / name
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        temporary = path.with_suffix(path.suffix + '.download')
        urllib.request.urlretrieve(url, temporary)
        if hashlib.sha256(temporary.read_bytes()).hexdigest() != expected:
            raise RuntimeError(f'Checksum mismatch for {name}; refusing to stage it.')
        temporary.replace(path)
    return path


def stage(name, data):
    path = OUTPUT / name
    if not path.is_file() or path.read_bytes() != data:
        path.write_bytes(data)


if __name__ == '__main__':
    main()
