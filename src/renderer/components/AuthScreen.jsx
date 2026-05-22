import React, { useState, useEffect } from 'react';
import { Copy, Power } from 'lucide-react';

export default function AuthScreen({ onActivated }) {
    const [hwid, setHwid] = useState('');
    const [key, setKey] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        window.electronAPI.getHWID().then(id => setHwid(id)).catch(() => setHwid('LỖI KẾT NỐI'));
    }, []);

    // Thuật toán Copy siêu cường, chống lỗi Electron
    const handleCopy = () => {
        if (!hwid || hwid === 'ĐANG TẢI...' || hwid === 'LỖI KẾT NỐI') return;
        
        try {
            navigator.clipboard.writeText(hwid).then(() => {
                alert("Đã copy Mã máy:\n" + hwid);
            }).catch(() => fallbackCopy(hwid));
        } catch (e) {
            fallbackCopy(hwid);
        }
    };

    const fallbackCopy = (text) => {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            document.execCommand('copy');
            alert("Đã copy Mã máy:\n" + text);
        } catch (err) {
            alert("Không thể copy tự động. Vui lòng bôi đen và copy thủ công!");
        }
        textArea.remove();
    };

    const handleActivate = async () => {
        if (!key.trim()) return setError("Vui lòng nhập mã kích hoạt!");
        setLoading(true);
        setError('');
        try {
            const result = await window.electronAPI.activateApp(key.trim());
            if (result.success) onActivated();
            else { setError(result.message); setLoading(false); }
        } catch (e) {
            setError("Lỗi kết nối. Chưa cập nhật file preload!");
            setLoading(false);
        }
    };

    return (
        <div className="h-screen w-screen bg-[#0b1120] flex items-center justify-center font-sans text-white relative overflow-hidden">
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20">
                <div className="w-[500px] h-[500px] bg-blue-600 rounded-full blur-[120px]"></div>
            </div>
            
            <div className="bg-[#141c2f] border border-slate-700/50 p-8 rounded-2xl shadow-2xl w-[420px] relative z-10 flex flex-col items-center">
                <div className="flex items-center gap-3 mb-2">
                    <div className="w-8 h-8 bg-white rounded-md flex items-center justify-center">
                        <div className="w-4 h-4 border-2 border-black rounded-sm transform rotate-45"></div>
                    </div>
                    <h1 className="text-3xl font-black tracking-wider">FLUXY STUDIO</h1>
                </div>
                <p className="text-slate-400 text-xs mb-8">Professional Edition v2.0</p>
                
                <div className="w-full bg-[#1e293b]/50 border border-slate-600/50 rounded-xl p-4 mb-5 relative group">
                    <p className="text-[10px] text-center font-semibold text-slate-400 mb-2 tracking-widest uppercase">Mã máy của bạn (HWID)</p>
                    <p className="text-center font-mono text-sm text-blue-400 tracking-wider break-all select-all">{hwid || 'ĐANG TẢI...'}</p>
                    <button onClick={handleCopy} className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-white transition-colors" title="Copy"><Copy size={16} /></button>
                </div>
                
                <div className="w-full mb-5">
                    <input type="text" value={key} onChange={e => setKey(e.target.value)} placeholder="Nhập Key kích hoạt vào đây..." className="w-full bg-[#0f172a] border border-slate-600 rounded-lg px-4 py-3.5 text-center font-mono font-bold text-white focus:outline-none focus:border-blue-500 transition-all"/>
                </div>
                
                {error && <p className="text-red-400 text-xs mb-4 text-center">{error}</p>}
                
                <button onClick={handleActivate} disabled={loading} className="w-full bg-[#6366f1] hover:bg-[#4f46e5] text-white font-bold py-3.5 rounded-lg text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50">
                    <Power size={18} /> {loading ? 'ĐANG XỬ LÝ...' : 'KÍCH HOẠT & CHẠY'}
                </button>

                {/* Phần thông tin liên hệ được làm nổi bật */}
                <div className="mt-7 text-center w-full pt-5 border-t border-slate-700/50">
                    <p className="text-sm text-slate-400 mb-1.5">Để mua Key kích hoạt, vui lòng liên hệ:</p>
                    <p className="text-lg font-bold text-emerald-400 tracking-wide bg-emerald-400/10 py-2 rounded-lg border border-emerald-400/20">
                        Zalo/SĐT: 0866 680 795
                    </p>
                </div>
            </div>
        </div>
    );
}