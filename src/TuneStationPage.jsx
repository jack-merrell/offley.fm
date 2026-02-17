import { useEffect, useMemo, useState } from 'react';
import { STATION_TAG_OPTIONS, normalizeStationTags } from './stationTags';

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const INITIAL_FORM = {
  id: '',
  title: '',
  host: '',
  frequency: '',
  lat: '',
  lon: '',
  signal: '3',
  tags: []
};

function clockLabel() {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date());
}

function postTuneStation(formData, onProgress, onStage) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/tune-station?stream=1');
    let readOffset = 0;
    let lineBuffer = '';
    let streamedPayload = null;

    const emitProgress = (percent, stage) => {
      if (typeof onProgress === 'function' && Number.isFinite(percent)) {
        onProgress(percent);
      }
      if (typeof onStage === 'function' && typeof stage === 'string' && stage.trim()) {
        onStage(stage.trim());
      }
    };

    const processEventLine = (line) => {
      if (!line) {
        return;
      }
      let payload = null;
      try {
        payload = JSON.parse(line);
      } catch (_error) {
        return;
      }

      if (payload?.type === 'progress') {
        emitProgress(Number.parseInt(payload.percent, 10), payload.stage);
        return;
      }

      if (payload?.type === 'result' || payload?.type === 'error') {
        streamedPayload = payload;
        emitProgress(Number.parseInt(payload.percent, 10), payload.stage);
      }
    };

    const processChunk = (chunk) => {
      if (!chunk) {
        return;
      }
      lineBuffer += chunk;
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? '';
      for (const line of lines) {
        processEventLine(line.trim());
      }
    };

    request.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable || typeof onProgress !== 'function') {
        return;
      }
      const uploadRatio = event.total > 0 ? event.loaded / event.total : 0;
      const percent = Math.max(1, Math.min(90, Math.round(uploadRatio * 90)));
      emitProgress(percent, 'Uploading files');
    });

    request.addEventListener('progress', () => {
      const text = request.responseText || '';
      if (text.length <= readOffset) {
        return;
      }
      const chunk = text.slice(readOffset);
      readOffset = text.length;
      processChunk(chunk);
    });

    request.addEventListener('load', () => {
      const text = request.responseText || '';
      if (text.length > readOffset) {
        processChunk(text.slice(readOffset));
        readOffset = text.length;
      }
      if (lineBuffer.trim()) {
        processEventLine(lineBuffer.trim());
        lineBuffer = '';
      }

      resolve({
        status: request.status,
        ok: request.status >= 200 && request.status < 300,
        text,
        payload: streamedPayload
      });
    });
    request.addEventListener('error', () => reject(new Error('Network error while uploading station.')));
    request.addEventListener('abort', () => reject(new Error('Station upload was cancelled.')));

    request.send(formData);
  });
}

function TuneStationPage() {
  const [form, setForm] = useState(INITIAL_FORM);
  const [audioFile, setAudioFile] = useState(null);
  const [artFile, setArtFile] = useState(null);
  const [isSubmitting, setSubmitting] = useState(false);
  const [pendingTag, setPendingTag] = useState(STATION_TAG_OPTIONS[0]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [clock, setClock] = useState(clockLabel());
  const [submitProgress, setSubmitProgress] = useState(0);
  const [submitStage, setSubmitStage] = useState('');

  const resolvedId = useMemo(() => form.id.trim() || slugify(form.title), [form.id, form.title]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(clockLabel()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function addTag() {
    setForm((prev) => {
      const next = normalizeStationTags([...(prev.tags || []), pendingTag]);
      return { ...prev, tags: next };
    });
  }

  function removeTag(tagToRemove) {
    setForm((prev) => ({
      ...prev,
      tags: (prev.tags || []).filter((tag) => tag !== tagToRemove)
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setResult(null);
    setSubmitProgress(0);
    setSubmitStage('');

    if (!resolvedId || !form.title.trim() || !form.frequency.trim() || !audioFile || !artFile) {
      setError('Please fill in id/title/frequency and choose both audio + artwork files.');
      return;
    }

    setSubmitting(true);
    try {
      const normalizedTags = normalizeStationTags(
        (form.tags || []).length > 0 ? form.tags : pendingTag ? [pendingTag] : []
      );
      const body = new FormData();
      body.set('id', resolvedId);
      body.set('title', form.title.trim());
      body.set('host', form.host.trim());
      body.set('frequency', form.frequency.trim());
      body.set('lat', form.lat.trim());
      body.set('lon', form.lon.trim());
      body.set('signal', form.signal);
      body.set('tags', JSON.stringify(normalizedTags));
      body.set('audio', audioFile);
      body.set('art', artFile);

      const response = await postTuneStation(body, (percent) => {
        setSubmitProgress((prev) => Math.max(prev, percent));
      }, (stage) => {
        setSubmitStage(stage);
      });

      const raw = response.text;
      let data = response.payload && typeof response.payload === 'object' ? response.payload : null;
      if (!data && raw) {
        try {
          data = JSON.parse(raw);
        } catch (_error) {
          data = null;
        }
      }

      if (data?.type === 'error' && data?.error) {
        throw new Error(data.error);
      }

      if (!response.ok || !data?.ok || !data?.station) {
        const message =
          data?.error ||
          (raw && !data ? raw : '') ||
          (response.status >= 500
            ? 'Upload failed. Check that `npm run admin-api` is running.'
            : `Station upload failed (${response.status}).`);
        throw new Error(message);
      }

      setSubmitProgress(100);
      setSubmitStage('Done');
      setResult(data.station);
      setForm(INITIAL_FORM);
      setPendingTag(STATION_TAG_OPTIONS[0]);
      setAudioFile(null);
      setArtFile(null);
    } catch (submissionError) {
      setError(submissionError.message || 'Station upload failed.');
    } finally {
      setSubmitting(false);
      window.setTimeout(() => {
        setSubmitProgress(0);
        setSubmitStage('');
      }, 420);
    }
  }

  return (
    <div className="app-shell tune-shell">
      <div className="scanlines" aria-hidden="true" />
      <div className="vignette" aria-hidden="true" />

      <main className="tune-stage">
        <section className="tune-panel">
          <header className="panel-head">
            <p className="panel-clock">{clock}</p>
            <div className="signal-bars signal-bars-steady" aria-label="Signal strength 4 of 4">
              {Array.from({ length: 4 }).map((_, index) => (
                <span key={`admin-signal-${index}`} className="signal-bar signal-bar-active" aria-hidden="true" />
              ))}
            </div>
          </header>

          <header className="tune-head">
            <p>Tune New Station</p>
            <a href="/" className="back-to-radio-link">
              back to radio
            </a>
          </header>
          <div className="panel-rule" />

          <form className="tune-form" onSubmit={handleSubmit}>
            <label>
              Station ID
              <input value={form.id} onChange={(event) => updateField('id', event.target.value)} placeholder="auto-from-title" />
            </label>

            <label>
              Title
              <input required value={form.title} onChange={(event) => updateField('title', event.target.value)} placeholder="Station title" />
            </label>

            <label>
              Host
              <input value={form.host} onChange={(event) => updateField('host', event.target.value)} placeholder="Host name" />
            </label>

            <div className="tune-grid">
              <label>
                Frequency (MHz)
                <input required value={form.frequency} onChange={(event) => updateField('frequency', event.target.value)} placeholder="93.20" />
              </label>
              <label>
                Signal (1-4)
                <select value={form.signal} onChange={(event) => updateField('signal', event.target.value)}>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                </select>
              </label>
            </div>

            <div className="tune-grid tune-grid-equal">
              <label>
                Latitude
                <input
                  value={form.lat}
                  onChange={(event) => updateField('lat', event.target.value)}
                  placeholder="51.507389"
                />
              </label>
              <label>
                Longitude
                <input
                  value={form.lon}
                  onChange={(event) => updateField('lon', event.target.value)}
                  placeholder="-0.127500"
                />
              </label>
            </div>

            <label>
              Tags
              <div className="tag-input-row">
                <select value={pendingTag} onChange={(event) => setPendingTag(event.target.value)}>
                  {STATION_TAG_OPTIONS.map((tag) => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))}
                </select>
                <button type="button" className="tag-add" onClick={addTag}>
                  add
                </button>
              </div>
              <div className="tag-chip-list" aria-label="Selected tags">
                {form.tags.length === 0 ? (
                  <span className="tag-chip tag-chip-empty">No tags selected</span>
                ) : (
                  form.tags.map((tag) => (
                    <button key={tag} type="button" className="tag-chip" onClick={() => removeTag(tag)}>
                      {tag}
                    </button>
                  ))
                )}
              </div>
            </label>

            <label>
              Audio Upload (source file)
              <input
                required
                type="file"
                accept="audio/*"
                onChange={(event) => setAudioFile(event.target.files?.[0] ?? null)}
              />
            </label>

            <label>
              Artwork Upload
              <input
                required
                type="file"
                accept="image/*"
                onChange={(event) => setArtFile(event.target.files?.[0] ?? null)}
              />
            </label>

            <button type="submit" className="tune-submit" disabled={isSubmitting}>
              {isSubmitting ? 'Tuning…' : 'Tune Station'}
            </button>
            {isSubmitting ? <p className="tune-progress">{submitProgress}%{submitStage ? ` · ${submitStage}` : ''}</p> : null}

            {error ? <p className="tune-error">{error}</p> : null}
            {result ? (
              <p className="tune-ok">
                Saved {result.title} at {result.frequency} MHz
              </p>
            ) : null}
          </form>
        </section>
      </main>
    </div>
  );
}

export default TuneStationPage;
