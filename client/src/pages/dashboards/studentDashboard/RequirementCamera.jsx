import { useEffect, useRef, useState } from 'react';
import styles from './Requirements.module.css';

function cameraError(error) {
  if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
    return 'Camera access is blocked. Allow camera access in your browser, or choose a photo from your device.';
  }
  if (error.name === 'NotFoundError') return 'No camera was found. Choose a photo from your device.';
  return 'The camera could not start. Close any other app using it, or choose a photo from your device.';
}

export default function RequirementCamera({ requirement, onSelect, onClose }) {
  const dialogRef = useRef(null);
  const videoRef = useRef(null);
  const pickerRef = useRef(null);
  const active = useRef(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog.open) dialog.showModal();
    active.current = true;
    let cancelled = false;
    let stream;

    async function startCamera() {
      if (cancelled) return;
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError('Camera preview needs HTTPS or localhost in a supported browser. You can still open your device’s photo picker.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        videoRef.current.srcObject = stream;
      } catch (err) {
        if (!cancelled) setError(cameraError(err));
      }
    }

    queueMicrotask(startCamera);
    return () => {
      cancelled = true;
      active.current = false;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function capture() {
    const video = videoRef.current;
    if (!video.videoWidth || !video.videoHeight) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      setError('The photo could not be captured. Choose a photo from your device.');
      return;
    }
    setSaving(true);
    context.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!active.current) return;
      setSaving(false);
      if (blob) {
        const file = new File([blob], `${requirement.code}-photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
        onSelect(file);
      } else {
        setError('The photo could not be saved. Try again or choose a photo from your device.');
      }
    }, 'image/jpeg', 0.9);
  }

  function selectFromDevice(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (file) onSelect(file);
  }

  return (
    <dialog
      ref={dialogRef}
      className={`${styles.modalCard} ${styles.cameraDialog}`}
      aria-labelledby="requirement-camera-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h3 className={styles.modalTitle} id="requirement-camera-title">Take photo</h3>
      <p className={styles.modalText}>{requirement.name}</p>
      {!error && !ready && <p role="status" className={styles.modalText}>Waiting for camera access…</p>}
      {error && <p role="alert" className={styles.modalText}>{error}</p>}
      <video
        ref={videoRef}
        className={styles.cameraPreview}
        aria-label="Live camera preview"
        hidden={Boolean(error)}
        autoPlay
        muted
        playsInline
        onPlaying={() => setReady(true)}
      />
      <input
        ref={pickerRef}
        type="file"
        accept=".png,.jpg,.jpeg,image/png,image/jpeg"
        capture="environment"
        hidden
        onChange={selectFromDevice}
      />
      <div className={styles.modalActions}>
        <button type="button" className={styles.btn} onClick={onClose}>Cancel</button>
        <button type="button" className={styles.btn} onClick={() => pickerRef.current.click()}>Open photo picker</button>
        <button type="button" className={styles.btnSuccess} onClick={capture} disabled={!ready || saving}>
          {saving ? 'Saving photo…' : 'Capture photo'}
        </button>
      </div>
    </dialog>
  );
}
