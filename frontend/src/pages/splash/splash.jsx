import React, { useEffect } from 'react';
import './splash.css';
import NcaiBrand, { NcaiMark } from '../../components/NcaiBrand';

const Splash = ({ onFinished }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onFinished();
    }, 4000); // 4 seconds delay
    return () => clearTimeout(timer);
  }, [onFinished]);

  return (
    <div className="splash-container">
      <div className="splash-content">
        <div className="icon-container">
          <NcaiMark size={64} />
        </div>
        <h1 className="splash-title">Smart Attendance</h1>
        <div className="splash-spinner"></div>
      </div>
      <div className="splash-footer">
        <div>Getting things ready...</div>
        <NcaiBrand height={30} style={{ marginTop: 14 }} />
      </div>
    </div>
  );
};

export default Splash;
