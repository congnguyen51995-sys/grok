import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import AuthScreen from './components/AuthScreen.jsx';
import './index.css';

function RootAuthWrapper() {
  const [isLicensed, setIsLicensed] = useState(false);
  const [checking, setChecking]     = useState(true);

  const doCheck = async () => {
    try {
      const result = await window.electronAPI.checkLicense();
      // result: {valid, daysLeft} (new format)
      const valid = typeof result === 'object' ? result.valid : !!result;
      setIsLicensed(valid);
      return valid;
    } catch (err) {
      console.error("LỖI checkLicense:", err);
      setIsLicensed(false);
      return false;
    }
  };

  useEffect(() => {
    // Kiểm tra lần đầu khi mở app
    doCheck().finally(() => setChecking(false));

    // Re-check mỗi 60s — nếu hết hạn trong lúc dùng → tự đá ra màn hình nhập key
    const interval = setInterval(doCheck, 60000);
    return () => clearInterval(interval);
  }, []);

  if (checking) return (
    <div className="h-screen w-screen bg-[#0b1120] flex items-center justify-center text-slate-500">
      Đang kiểm tra bảo mật...
    </div>
  );

  if (!isLicensed) return <AuthScreen onActivated={() => setIsLicensed(true)} />;

  return <App onLicenseExpired={() => setIsLicensed(false)} />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RootAuthWrapper />
  </React.StrictMode>
);