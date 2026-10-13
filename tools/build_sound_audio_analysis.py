"""Signal regression for production sound-v2 WAVs (numpy/scipy).

Render corner-sweep plus solos: tyres, tyre-roll, tyre-scrub, tyre-squeal,
engine, engine-low and engine-mid using tools/build_sound_audio.mjs.
Checks audio samples, including broad noisy modes rather than pure sine lines.
"""
from pathlib import Path
import json
import numpy as np
from scipy import signal
from scipy.io import wavfile

ROOT = Path('.scratch/sound-v2')


def read(name):
    sr, pcm = wavfile.read(ROOT / name)
    samples = pcm.astype(float) / 32768
    return sr, samples.mean(axis=1) if samples.ndim > 1 else samples


def envelope_repeat(name):
    sr, samples = read(name)
    band = signal.sosfilt(signal.butter(4, [5000, 9000], btype='band', fs=sr, output='sos'), samples)
    hop = round(sr * .01)
    envelope = np.sqrt(np.mean(band[:len(band)//hop*hop].reshape(-1, hop)**2, axis=1))[100:]
    centered = envelope - envelope.mean()
    corr = signal.correlate(centered, centered, mode='full')[len(centered)-1:]
    corr /= max(corr[0], 1e-30)
    lag = int(np.argmax(corr[30:301])) + 30
    return {'max_repeat_300_3000ms': float(corr[lag]), 'lag_seconds': lag * .01,
            'band_rms_db': float(20*np.log10(np.sqrt(np.mean(band[sr:]**2)) + 1e-20))}


def band_db(samples, sr, low, high, start, duration=.5):
    band = signal.sosfilt(signal.butter(4, [low, high], btype='band', fs=sr, output='sos'), samples)
    return float(20*np.log10(np.sqrt(np.mean(band[round(start*sr):round((start+duration)*sr)]**2)) + 1e-20))


def noisy_modes(samples, sr, second):
    # Average a half-second spectrum: clean sine clusters fail the noise-bandwidth requirement.
    hz, power = signal.welch(samples[round((second-.25)*sr):round((second+.25)*sr)], sr,
                             nperseg=4096, noverlap=3072)
    region = (hz > 800) & (hz < 1600)
    fundamental = float(hz[region][np.argmax(power[region])])
    p = power[region]
    bandwidth = float((hz[1]-hz[0]) * p.sum()**2 / max(np.sum(p*p), 1e-30))
    harmonic = power[abs(hz-fundamental*2) < 160].max()
    between = np.median(power[abs(hz-fundamental*1.5) < 120])
    return {'time': second, 'fundamental_hz': fundamental, 'effective_bandwidth_hz': bandwidth,
            'second_harmonic_prominence_db': float(10*np.log10(harmonic / max(between, 1e-30)))}


report = {'repetition': {}}
for layer in ('engine', 'engine-low', 'engine-mid', 'tyre-roll'):
    row = envelope_repeat(f'corner-sweep-{layer}.wav')
    report['repetition'][layer] = row
    assert row['max_repeat_300_3000ms'] < .3, (layer, row)
    before = ROOT / f'corner-sweep-{layer}-before.wav'
    if before.exists():
        report['repetition'][layer + '-before'] = envelope_repeat(before.name)

sr, sweep = read('corner-sweep-tyres.wav')
report['progression'] = {
    'pre_peak_scrub_rise_db': band_db(sweep, sr, 400, 750, 4.2) - band_db(sweep, sr, 400, 750, 1),
    'post_peak_squeal_rise_db': band_db(sweep, sr, 1000, 1600, 7.2) - band_db(sweep, sr, 1000, 1600, 4.2),
}
assert report['progression']['pre_peak_scrub_rise_db'] > 15, report
assert report['progression']['post_peak_squeal_rise_db'] > 5, report
sr, squeal = read('corner-sweep-tyre-squeal.wav')
report['noisy_modes'] = [noisy_modes(squeal, sr, t) for t in (5.8, 6.6, 7.5)]
for row in report['noisy_modes']:
    assert 160 < row['effective_bandwidth_hz'] < 500, row
    assert row['second_harmonic_prominence_db'] > 5, row
assert report['noisy_modes'][-1]['fundamental_hz'] > report['noisy_modes'][0]['fundamental_hz'] + 200
# The post-peak onset takes hundreds of milliseconds, rather than reaching full level immediately.
onset = [band_db(squeal, sr, 800, 1600, t, .15) for t in (5.3, 5.8, 6.3, 7.5)]
report['squeal_onset_db'] = onset
assert onset[-1] > onset[0] + 15 and onset[2] > onset[1] + 2, onset
(ROOT / 'review-analysis.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
