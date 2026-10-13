"""Signal regression for sound-v2 renders (numpy/scipy, like build_engine_audio.py).

First render the default scenarios and renderSoundV2({scenarios:['corner-sweep'],
isolate:'tyres'}) in the browser harness. Then run this script from the repo root.
Checks the actual WAVs, not just the parameter mapping; writes review-analysis.json.
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
    band = signal.sosfilt(signal.butter(4, [6000, 9000], btype='band', fs=sr, output='sos'), samples)
    hop = round(sr * .01)
    envelope = np.sqrt(np.mean(band[:len(band)//hop*hop].reshape(-1, hop)**2, axis=1))[100:]
    centered = envelope - envelope.mean()
    corr = signal.correlate(centered, centered, mode='full')[len(centered)-1:]
    corr /= max(corr[0], 1e-30)
    lag = int(np.argmax(corr[35:66])) + 35
    return {'max_repeat_350_650ms': float(corr[lag]), 'lag_seconds': lag * .01}


def spectrum_at(samples, sr, second):
    # 170 ms window resolves tonal modes while following the sliding pitch.
    size = 8192
    start = round(sr * second) - size // 2
    power = abs(np.fft.rfft(samples[start:start+size] * np.hanning(size)))**2
    return np.fft.rfftfreq(size, 1/sr), power


def ridge(samples, sr, second):
    hz, power = spectrum_at(samples, sr, second)
    search = (hz > 800) & (hz < 1650)
    fundamental = hz[np.flatnonzero(search)[np.argmax(power[search])]]
    def prominence(center):
        peak = power[abs(hz-center) < 60].max()
        floor = np.median(power[(abs(hz-center) > 100) & (abs(hz-center) < 300)])
        return float(10*np.log10(peak/max(floor, 1e-30)))
    return {'time': second, 'fundamental_hz': float(fundamental),
            'fundamental_prominence_db': prominence(fundamental),
            'harmonic_prominence_db': prominence(fundamental*2)}


report = {'corner': envelope_repeat('corner-limit.wav')}
assert report['corner']['max_repeat_350_650ms'] < .4, report
baseline = ROOT / 'review-before/corner-limit.wav'
if baseline.exists():
    report['before'] = envelope_repeat('review-before/corner-limit.wav')
sr, sweep = read('corner-sweep-tyres.wav')
def band_db(low, high, start):
    band = signal.sosfilt(signal.butter(4, [low, high], btype='band', fs=sr, output='sos'), sweep)
    return float(20*np.log10(np.sqrt(np.mean(band[round(start*sr):round((start+.5)*sr)]**2))))

report['progression'] = {
    'pre_peak_howl_rise_db': band_db(400, 650, 4.2) - band_db(400, 650, 1),
    'post_peak_squeal_rise_db': band_db(800, 1600, 7.2) - band_db(800, 1600, 4.2),
}
assert report['progression']['pre_peak_howl_rise_db'] > 5, report
assert report['progression']['post_peak_squeal_rise_db'] > 15, report
report['tonal_sweep'] = [ridge(sweep, sr, t) for t in (5.8, 6.6, 7.5)]
for row in report['tonal_sweep']:
    assert row['fundamental_prominence_db'] > 12, row
    assert row['harmonic_prominence_db'] > 8, row
assert report['tonal_sweep'][-1]['fundamental_hz'] > report['tonal_sweep'][0]['fundamental_hz'] + 200
(ROOT / 'review-analysis.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
