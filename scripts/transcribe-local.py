"""Local audio transcription. Credentials and remote URLs are never accepted here."""
import json
import os
import sys
from pathlib import Path

os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
os.environ['HF_HUB_DISABLE_PROGRESS_BARS'] = '1'

try:
    from faster_whisper import WhisperModel
    payload = json.load(sys.stdin)
    audio = Path(payload['file']).resolve(strict=True)
    if audio.suffix.lower() != '.wav':
        raise ValueError('Unsupported local audio')
    model = WhisperModel('base', device='cpu', compute_type='int8', cpu_threads=2, num_workers=1)
    segments, info = model.transcribe(str(audio), language='pt', beam_size=3, vad_filter=True)
    result = [{'start': round(s.start, 2), 'end': round(s.end, 2), 'text': s.text.strip()} for s in segments]
    print(json.dumps({'duration': info.duration, 'language': info.language, 'segments': result}, ensure_ascii=False))
except Exception:
    print(json.dumps({'error': 'Local transcription unavailable'}))
    sys.exit(1)
