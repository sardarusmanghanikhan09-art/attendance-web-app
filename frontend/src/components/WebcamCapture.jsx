import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { compressImage } from '../utils/imageCompression';
import { analyzeFace, preloadFaceModels } from '../face/faceEngine';

// Popup that takes face photos from the webcam for registration.
// Every shot is checked for a face on this device and compressed like uploaded photos (500 px, JPEG 0.7).
// Calls onDone(dataUrls) when the admin presses "Use these photos".
export default function WebcamCapture({ open, ...rest }) {
  // Mounting only while open gives every session fresh state and releases the camera on close
  return open ? <WebcamCaptureDialog {...rest} /> : null;
}

function WebcamCaptureDialog({ onClose, onDone, minShots = 4, maxShots = 5 }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [shots, setShots] = useState([]);
  const [status, setStatus] = useState('Starting camera...');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    preloadFaceModels();
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot open the camera.');
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setReady(true);
        setStatus(`Look at the camera and press Capture. Turn your head slightly between shots (${minShots} to ${maxShots} photos).`);
      } catch (err) {
        const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
        setError(denied ? 'Camera permission was denied. Allow camera access in the browser and try again.' : (err.message || 'Could not open the camera.'));
        setStatus('');
      }
    })();
    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };
  }, [minShots, maxShots]);

  const capture = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || busy || shots.length >= maxShots) return;
    setBusy(true);
    setError('');
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.92));
      if (!blob) throw new Error('Could not read the camera frame.');
      const photo = await compressImage(blob, 500, 0.7);
      setStatus('Checking the photo for a face...');
      const face = await analyzeFace(photo);
      if (!face) {
        setError('No face found in that shot. Face the camera in good light and try again.');
      } else {
        const next = [...shots, photo];
        setShots(next);
        setStatus(next.length >= maxShots
          ? 'All photos taken. Press "Use these photos".'
          : next.length >= minShots
            ? `${next.length} photos taken. You can add one more or press "Use these photos".`
            : `${next.length} of ${minShots} photos taken. Turn your head slightly and capture again.`);
      }
    } catch (err) {
      setError(err.message || 'Capture failed.');
    }
    setBusy(false);
  };

  const finish = () => {
    if (shots.length < minShots) return;
    onDone(shots);
    onClose();
  };

  const btn = (bg, disabled) => ({
    padding: '10px 16px', borderRadius: '8px', border: 'none', fontWeight: 600, fontSize: '14px',
    background: disabled ? '#cbd5e1' : bg, color: '#fff', cursor: disabled ? 'not-allowed' : 'pointer',
  });

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.75)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: '#fff', borderRadius: '14px', width: '100%', maxWidth: '560px', maxHeight: '95vh', overflowY: 'auto', padding: '18px', boxShadow: '0 20px 50px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ margin: 0, fontSize: '18px', color: '#0f172a' }}>Register face with webcam</h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer', color: '#64748b' }} aria-label="Close">×</button>
        </div>

        <div style={{ position: 'relative', background: '#0f172a', borderRadius: '10px', overflow: 'hidden', aspectRatio: '4 / 3' }}>
          <video ref={videoRef} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
          <div style={{ position: 'absolute', left: '50%', top: '50%', width: '42%', height: '62%', transform: 'translate(-50%, -50%)', border: '3px dashed rgba(255,255,255,0.7)', borderRadius: '50%', pointerEvents: 'none' }} />
        </div>

        {status && <p style={{ margin: '10px 0 0', fontSize: '13px', color: '#334155' }}>{status}</p>}
        {error && <p style={{ margin: '8px 0 0', fontSize: '13px', color: '#dc2626', fontWeight: 600 }}>{error}</p>}

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px', minHeight: '64px' }}>
          {shots.map((s, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <img src={s} alt={`Shot ${i + 1}`} style={{ width: '64px', height: '64px', objectFit: 'cover', borderRadius: '8px', border: '2px solid #22c55e' }} />
              <button
                type="button"
                onClick={() => setShots(prev => prev.filter((_, idx) => idx !== i))}
                style={{ position: 'absolute', top: '-6px', right: '-6px', width: '20px', height: '20px', borderRadius: '50%', border: 'none', background: '#ef4444', color: '#fff', fontSize: '12px', cursor: 'pointer', lineHeight: '20px', padding: 0 }}
                aria-label="Remove shot"
              >×</button>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between', flexWrap: 'wrap', marginTop: '14px' }}>
          <span style={{ alignSelf: 'center', fontSize: '13px', fontWeight: 600, color: shots.length >= minShots ? '#16a34a' : '#64748b' }}>
            {shots.length}/{maxShots} photos
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" onClick={capture} disabled={!ready || busy || shots.length >= maxShots} style={btn('#2563eb', !ready || busy || shots.length >= maxShots)}>
              {busy ? 'Checking...' : 'Capture'}
            </button>
            <button type="button" onClick={finish} disabled={shots.length < minShots} style={btn('#16a34a', shots.length < minShots)}>
              Use these photos
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
