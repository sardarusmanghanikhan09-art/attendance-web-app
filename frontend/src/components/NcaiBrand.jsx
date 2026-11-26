import React, { useState } from 'react';

// NCAI logos are loaded from ncai.pk (the organisation's own site).
// If the image can't load (offline), a text wordmark is shown instead.
export const NCAI_MARK_URL = 'https://ncai.pk/wp-content/uploads/2023/12/cropped-NCAI-Site-Identity-192x192.png';
export const NCAI_LOGO_URL = 'https://ncai.pk/wp-content/uploads/2022/07/horizontal-logo-2-04-1.png';

export const NcaiMark = ({ size = 56, className = '' }) => {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className={className} style={{ fontFamily: 'Montserrat, sans-serif', fontWeight: 800, fontSize: size * 0.34, color: '#2c5a88' }}>
        NC<span style={{ color: '#da7f33' }}>AI</span>
      </span>
    );
  }
  return <img src={NCAI_MARK_URL} alt="NCAI" width={size} height={size} className={className} onError={() => setFailed(true)} style={{ objectFit: 'contain' }} />;
};

const NcaiBrand = ({ label = 'A product of', height = 28, style }) => {
  const [failed, setFailed] = useState(false);
  return (
    <a className="ncai-brand" href="https://ncai.pk" target="_blank" rel="noopener noreferrer" style={style}>
      <span>{label}</span>
      {failed ? (
        <span><strong>NCAI</strong> <em>National Centre of Artificial Intelligence</em></span>
      ) : (
        <img src={NCAI_LOGO_URL} alt="NCAI: National Centre of Artificial Intelligence" style={{ height }} onError={() => setFailed(true)} />
      )}
    </a>
  );
};

export default NcaiBrand;
