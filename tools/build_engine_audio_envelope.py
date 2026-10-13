"""Check the production engine solo and plot its 100 ms RMS envelope.

First render corner-sweep/{engine,engine-low,engine-mid} and optional 40-second
engine-steady-3600-engine with tools/build_sound_audio.mjs. Requires numpy,
scipy and matplotlib. Old reviewed WAVs may be kept in review-8113734/.
"""
from pathlib import Path
import json
import numpy as np
from scipy import signal
from scipy.io import wavfile
from scipy.ndimage import uniform_filter1d
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT = Path('.scratch/sound-v2')


def envelope(path, band=None):
    sr, pcm = wavfile.read(path)
    x = pcm.astype(float) / 32768
    if x.ndim > 1:
        x = x.mean(axis=1)
    if band:
        x = signal.sosfilt(signal.butter(4, band, btype='band', fs=sr, output='sos'), x)
    power = uniform_filter1d(x*x, round(sr*.1))
    # Exclude the actual engine-start fade and half a measurement window at the end.
    indexes = np.arange(sr, len(x)-round(sr*.05), round(sr*.01))
    db = 10*np.log10(np.maximum(1e-20, power[indexes]))
    return indexes/sr, db


report = {'window_ms': 100, 'hop_ms': 10, 'excluded_start_seconds': 1, 'layers': {}}
for name in ('corner-sweep-engine', 'corner-sweep-engine-low', 'corner-sweep-engine-mid',
             'engine-steady-3600-engine'):
    path = ROOT / (name+'.wav')
    if not path.exists():
        continue
    report['layers'][name] = {}
    for label, band in (('full', None), ('fundamental_80_130hz', [80, 130])):
        t, db = envelope(path, band)
        report['layers'][name][label] = {'min_dbfs': float(db.min()), 'max_dbfs': float(db.max()),
                                        'peak_to_peak_db': float(np.ptp(db))}
    # Test the actual broad-band engine level, not just a percentile or a long average.
    assert report['layers'][name]['full']['peak_to_peak_db'] < 1, (name, report['layers'][name])
    if name in ('corner-sweep-engine', 'engine-steady-3600-engine'):
        assert report['layers'][name]['fundamental_80_130hz']['peak_to_peak_db'] < 2, (name, report['layers'][name])

fig, axes = plt.subplots(2, 1, figsize=(12, 7), sharex=True, layout='constrained')
for ax, band, title in zip(axes, [None, [80, 130]], ['Engine solo · full spectrum', 'Engine solo · 80–130 Hz fundamental']):
    for folder, label, color in [(ROOT/'review-8113734', '8113734', '#d76838'), (ROOT, 'Corrected grains', '#178575')]:
        path = folder/'corner-sweep-engine.wav'
        if not path.exists():
            continue
        t, db = envelope(path, band)
        ax.plot(t, db-db.mean(), label=f'{label}: {np.ptp(db):.2f} dB peak-to-peak', color=color, lw=1.3)
    ax.set_title(title, loc='left'); ax.set_ylabel('RMS relative to mean (dB)')
    ax.set_ylim(-12, 7); ax.grid(alpha=.2); ax.legend(loc='lower right')
axes[-1].set_xlabel('Time (seconds) · 100 ms RMS window, 10 ms hops; startup fade excluded')
fig.suptitle('MINI · constant 3600 RPM / 50% load', fontsize=16)
fig.savefig(ROOT/'engine-rms-envelope.png', dpi=150)
if (ROOT/'engine-steady-3600-engine.wav').exists():
    fig, axes = plt.subplots(2, 1, figsize=(12, 6), sharex=True, layout='constrained')
    for ax, band, title in zip(axes, [None, [80, 130]], ['Full spectrum', '80–130 Hz fundamental']):
        t, db = envelope(ROOT/'engine-steady-3600-engine.wav', band)
        ax.plot(t, db-db.mean(), color='#178575', lw=1)
        ax.set_title(f'{title}: {np.ptp(db):.2f} dB peak-to-peak', loc='left')
        ax.set_ylim(-1.5, 1.5); ax.grid(alpha=.2); ax.set_ylabel('RMS relative to mean (dB)')
    axes[-1].set_xlabel('Time (seconds) · 100 ms RMS windows, 10 ms hops')
    fig.suptitle('MINI · 40-second steady-load check, including loop wraps', fontsize=15)
    fig.savefig(ROOT/'engine-rms-wrap.png', dpi=150)
(ROOT/'engine-rms-envelope.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps(report, indent=2))
