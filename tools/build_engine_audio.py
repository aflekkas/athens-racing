#!/usr/bin/env python3
"""Rebuild the in-game recordings. Requires ffmpeg, numpy and scipy.
Usage: python tools/build_engine_audio.py --cache /tmp/paraliaki-audio
Source masters stay in the cache; only edited game assets are distributed.
See assets/audio/engines/sources.json for authors, licenses and substitutions.
"""
import argparse, hashlib, json, pathlib, subprocess, urllib.request
import numpy as np
from scipy import signal

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEST = ROOT / 'assets/audio/engines'
SR = 44100

def decode(path):
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path), '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'])
    return np.frombuffer(raw, np.float32).copy()

def stabilize(x, rpm, cylinders):
    # Track the firing harmonic locally, then resample by its accumulated phase.
    # This removes the recorded acceleration from a loop; game RPM supplies it.
    f0 = rpm * cylinders / 120
    f, t, z = signal.stft(x, SR, nperseg=8192, noverlap=6144, nfft=32768)
    region = (f > f0 * .85) & (f < f0 * 1.15)
    power = np.abs(z[region]); hz = f[region][np.argmax(power, axis=0)]
    hz = signal.medfilt(hz, 5)
    ratio = np.interp(np.arange(len(x)) / SR, t, hz / f0)
    phase = np.cumsum(ratio)
    return np.interp(np.arange(phase[0], phase[-1]), phase, x)

def loop(x):
    n = min(round(.09 * SR), len(x) // 5)
    # Linear overlap preserves level for correlated engine waveforms.
    w = np.linspace(0, 1, n)
    return np.r_[x[n:-n], x[-n:] * (1-w) + x[:n] * w]

def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--cache', type=pathlib.Path, default=ROOT / '.cache/engine-audio')
    parser.add_argument('--only', nargs='+', help='Rebuild only these asset filenames (e.g. mini-mid.wav)')
    args = parser.parse_args(); args.cache.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((DEST / 'sources.json').read_text())
    selected = [asset for asset in manifest['assets'] if not args.only or asset['file'] in args.only]
    if args.only and set(args.only) - {asset['file'] for asset in selected}:
        parser.error('Unknown asset filename in --only')
    needed_sources = {asset['source'] for asset in selected}
    decoded = {}
    for key, source in manifest['sources'].items():
        if key not in needed_sources: continue
        path = args.cache / source['cacheFile']
        if not path.exists():
            print('Downloading', key, flush=True)
            with urllib.request.urlopen(source['downloadUrl'], timeout=120) as response:
                path.write_bytes(response.read())
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if source.get('sha256') and source['sha256'] != digest:
            raise ValueError(f'Source checksum mismatch: {key}')
        source['sha256'] = digest
        decoded[key] = decode(path)
    for asset in selected:
        x = decoded[asset['source']][round(asset['trim'][0]*SR):round(asset['trim'][1]*SR)]
        x = signal.sosfilt(signal.butter(2, 25, fs=SR, btype='highpass', output='sos'), x)
        if asset['kind'] == 'loop':
            if asset.get('stabilize', True): x = stabilize(x, asset['rpm'], asset['cylinders'])
            x = loop(x)
        else:
            n = round(.008*SR); x[:n] *= np.linspace(0, 1, n)
            n = round(.22*SR); x[-n:] *= np.linspace(1, 0, n)
        x -= np.mean(x)
        # Matched loop loudness, with conservative peak headroom. No hard clipping.
        x *= min(.17 / max(1e-8, np.sqrt(np.mean(x*x))), .85 / max(1e-8, np.max(np.abs(x))))
        path = DEST / asset['file']
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-', '-c:a', 'pcm_s16le', str(path)], input=x.astype(np.float32).tobytes(), check=True)
        asset['duration'] = round(len(x)/SR, 5)
        asset['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
        print(asset['file'], asset['duration'], 'seconds')
    (DEST / 'sources.json').write_text(json.dumps(manifest, indent=2) + '\n')

if __name__ == '__main__': main()
