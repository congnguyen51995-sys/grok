import React, { useState } from 'react';

const TEXT_EFFECTS = [
  { id: 'kinetic-stagger',   title: 'Kinetic Word Stagger (Bung nở từng từ)',        badge: 'Motion Spring',  desc: 'Phân tách tiêu đề thành từng từ, kích hoạt chuỗi lò xo velocity với độ trễ liên tiếp và góc xoay động lực học.',           engine: 'Remotion Spring Physics + Stagger Array' },
  { id: 'elastic-bounce',    title: 'Elastic Bouncy Pop (Đàn hồi nảy cực đại)',      badge: 'Elastic Curve',  desc: 'Hiệu ứng phóng to vượt ngưỡng (overshoot) rồi rung nảy đàn hồi về kích thước chuẩn, thu hút ánh nhìn tức thì.',          engine: 'High-Mass Damped Spring Engine' },
  { id: 'glitch-distortion', title: 'Cyberpunk Glitch & RGB Split (Nhiễu điện tử)',  badge: 'RGB Chromatic',  desc: 'Mô phỏng lỗi tín hiệu kỹ thuật số, tách hai dải màu Cyan & Red lệch pha ngẫu nhiên kết hợp kéo nghiêng skew góc cạnh.',  engine: 'Pseudo-Random Frame Modulation' },
  { id: 'cinematic-3d-tilt', title: '3D Perspective Tilt & Depth Blur (3D chiều sâu)', badge: '3D Transform', desc: 'Chữ lật từ không gian 3D với góc nghiêng pitch/yaw kết hợp hiệu ứng mờ tiêu cự điện ảnh (depth blur) mượt mà.',           engine: 'CSS 3D Matrix Perspective' },
  { id: 'neon-pulse',        title: 'Neon Glow Heartbeat Pulse (Xung điện Neon)',    badge: 'Luminance',      desc: 'Tạo vầng hào quang neon phát sáng lan tỏa xung quanh văn bản, co bóp nhịp nhàng theo hàm sin tần số khung hình.',         engine: 'Sine Oscillation Luminance Shader' },
  { id: 'typewriter-beam',   title: 'Laser Beam Typewriter (Máy đánh chữ Laser)',    badge: 'Terminal',       desc: 'Gõ từng ký tự theo nhịp độ thời gian chính xác, kết hợp con trỏ chùm sáng laser nhấp nháy mang phong cách sci-fi.',       engine: 'Frame-Interpolated Char Stepper' },
];

const ATMOSPHERE_EFFECTS = [
  { id: 'film-grain',      title: '35mm Film Grain Noise (Hạt phim nhựa tự nhiên)',        badge: 'Film Look',      desc: 'Tạo nhiễu hạt phim analog biến thiên động theo từng frame, mang lại chất điện ảnh chân thực và loại bỏ cảm giác đồ họa phẳng.',         engine: 'Procedural Frame-Seed Noise Generator' },
  { id: 'chromatic-rgb',   title: 'RGB Chromatic Aberration (Tách sắc quang sai viền)',    badge: 'Lens Distortion', desc: 'Mô phỏng thấu kính quang học góc rộng khi viền khung hình bị phân tách thành hai kênh đỏ hồng (magenta) và xanh ngọc (cyan).',   engine: 'Screen Blend Optical Shift' },
  { id: 'vhs-scanlines',   title: 'VHS Scanlines & CRT Tracking (Vạch quét CRT)',          badge: 'Retro Cyber',    desc: 'Đường kẻ quét CRT ngang mờ kết hợp thanh cuộn vệt tracking chạy dọc, tái hiện cảm giác băng từ retro của thập niên 90.',              engine: 'Scanline Raster & Linear Gradient Bar' },
  { id: 'light-leak',      title: 'Anamorphic Light Leak Sweep (Quét lóa sáng quang học)', badge: 'Lens Flare',     desc: 'Dải sáng elip ấm áp quét chéo qua khung hình theo dòng thời gian, tạo hiệu ứng ống kính máy quay phim điện ảnh.',                   engine: 'Anamorphic Radial Interpolation' },
  { id: 'dust-particles',  title: 'Cinematic Bokeh Dust (Hạt bụi ánh sáng lơ lửng)',      badge: 'Atmosphere',     desc: 'Các điểm bụi bokeh vi hạt nhẹ nhàng bay ngược hướng ánh sáng, mang lại chiều sâu không gian huyền ảo cho cảnh quay.',              engine: 'Multi-layered Floating Particle Drift' },
];

const CAMERA_EFFECTS = [
  { id: 'camera-shake',       title: 'Organic Handheld Camera Shake (Rung tay cầm)', desc: 'Mô phỏng chuyển động tay cầm máy quay thực tế với bước dịch chuyển x/y ngẫu nhiên mượt mà kết hợp zoom chống cắt viền.' },
  { id: 'dolly-in-kenburns',  title: 'Ken Burns Dolly In & Out (Zoom cận cảnh quang học)', desc: 'Tịnh tiến tỷ lệ khung hình từ 100% lên 118% dọc theo toàn bộ thời lượng cảnh quay, giữ trọn độ nét của hình ảnh và video AI.' },
  { id: 'pan-lateral',        title: 'Smooth Lateral Pan (Lướt ngang điện ảnh)', desc: 'Dịch chuyển ống kính từ trái sang phải với góc nhìn rộng, lý tưởng cho các cảnh phong cảnh góc quay flycam.' },
];

const GESTURE_FEATURES = [
  { title: 'Kéo thả Tự do trên Khung Video (@use-gesture/react)', desc: 'Kéo rê trực tiếp nhãn Callout, Watermark hay Hologram Badge đến vị trí bất kỳ trên màn hình video bằng chuột hoặc cảm ứng.' },
  { title: 'Cuộn chuột / Pinch để Phóng to / Thu nhỏ', desc: 'Sự kiện Wheel / Pinch của @use-gesture/react để thay đổi kích thước Sticker theo tỷ lệ từ 40% đến 250% thời gian thực.' },
  { title: 'Nút Xoay nhanh 360° Góc quay', desc: 'Xoay nghiêng nhãn dán từng nấc 15° để tạo bố cục góc chéo bắt mắt trên khung bounding box.' },
];

const s = {
  overlay: { position:'fixed', inset:0, zIndex:9000, background:'rgba(0,0,0,0.82)', backdropFilter:'blur(10px)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 },
  modal:   { background:'#0A0A12', border:'1px solid rgba(99,102,241,0.3)', borderRadius:16, width:'100%', maxWidth:900, maxHeight:'90vh', display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'0 0 60px rgba(99,102,241,0.15)' },
  header:  { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 20px', borderBottom:'1px solid rgba(99,102,241,0.2)', background:'#07070C' },
  tabs:    { display:'flex', gap:6, padding:'8px 16px', borderBottom:'1px solid rgba(30,30,50,0.8)', background:'#08080E', overflowX:'auto' },
  body:    { flex:1, padding:16, overflowY:'auto', background:'#050508' },
  grid:    { display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 },
  card:    { padding:14, borderRadius:12, border:'1px solid #1e1e32', background:'#090912', display:'flex', flexDirection:'column', justifyContent:'space-between', cursor:'default', transition:'border-color .2s' },
  cardActive: { background:'rgba(30,20,80,0.5)', border:'1px solid rgba(6,182,212,0.9)', boxShadow:'0 0 14px rgba(6,182,212,0.2)' },
  badge:   { padding:'2px 7px', borderRadius:4, fontSize:10, fontFamily:'monospace', fontWeight:700, background:'rgba(99,102,241,0.2)', color:'#67e8f9', border:'1px solid rgba(99,102,241,0.3)' },
  engine:  { padding:'6px 10px', borderRadius:8, background:'rgba(0,0,0,0.6)', border:'1px solid #1e1e32', fontFamily:'monospace', fontSize:10, color:'#22d3ee', marginTop:6 },
  footer:  { padding:'10px 20px', borderBottom:0, borderTop:'1px solid #1e1e32', background:'#07070C', display:'flex', alignItems:'center', justifyContent:'space-between', fontSize:11, color:'#64748b', fontFamily:'monospace' },
};

function TabBtn({ label, active, onClick, icon }) {
  return (
    <button onClick={onClick} style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 12px', borderRadius:8, fontSize:11, fontWeight:600, border:'none', cursor:'pointer', whiteSpace:'nowrap', background: active ? 'rgba(99,102,241,0.2)' : 'transparent', color: active ? '#67e8f9' : '#64748b', boxShadow: active ? '0 0 10px rgba(99,102,241,0.18)' : 'none', outline: active ? '1px solid rgba(99,102,241,0.5)' : 'none' }}>
      <span>{icon}</span><span>{label}</span>
    </button>
  );
}

function EffectCard({ item, isActive, onApply, field }) {
  return (
    <div style={{ ...s.card, ...(isActive ? s.cardActive : {}) }}>
      <div>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
          <span style={{ fontSize:11, fontWeight:700, color:'#fff' }}>{item.title}</span>
          <span style={s.badge}>{item.badge}</span>
        </div>
        <p style={{ fontSize:11, color:'#94a3b8', lineHeight:1.5, margin:0 }}>{item.desc}</p>
        <div style={s.engine}>Engine: {item.engine}</div>
      </div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:12, paddingTop:10, borderTop:'1px solid #1e1e32' }}>
        <span style={{ fontSize:10, fontFamily:'monospace', color:'#475569' }}>{isActive ? 'Đang áp dụng' : 'Sẵn sàng áp dụng'}</span>
        <button onClick={() => onApply(field, item.id)} style={{ padding:'5px 14px', borderRadius:99, fontSize:11, fontWeight:700, border:'none', cursor:'pointer', background: isActive ? '#22d3ee' : '#1e1e32', color: isActive ? '#050508' : '#fff', display:'flex', alignItems:'center', gap:5 }}>
          {isActive && <span>✓</span>}
          <span>{isActive ? 'Đã chọn' : 'Áp dụng ngay'}</span>
        </button>
      </div>
    </div>
  );
}

function InfoBanner({ icon, text }) {
  return (
    <div style={{ padding:12, borderRadius:10, background:'rgba(30,20,80,0.25)', border:'1px solid rgba(99,102,241,0.3)', display:'flex', gap:10, marginBottom:14 }}>
      <span style={{ fontSize:14, color:'#67e8f9', flexShrink:0, marginTop:1 }}>{icon}</span>
      <p style={{ fontSize:11, color:'#cbd5e1', lineHeight:1.55, margin:0 }}>{text}</p>
    </div>
  );
}

export default function FXCatalogModal({ isOpen, onClose, segment, onApplyEffect }) {
  const [tab, setTab] = useState('text');
  if (!isOpen || !segment) return null;

  const sceneLabel = segment ? `#${segment.id ?? '?'} • ${(segment.text_heading || segment.narration?.slice(0, 30) || 'Phân cảnh').replace(/\n.*/s, '')}` : '';

  const apply = (field, value) => {
    onApplyEffect?.({ [field]: value });
    onClose();
  };

  return (
    <div style={s.overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={s.modal}>
        {/* Header */}
        <div style={s.header}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:34, height:34, borderRadius:10, background:'rgba(99,102,241,0.2)', border:'1px solid rgba(99,102,241,0.4)', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 0 12px rgba(99,102,241,0.3)', fontSize:18 }}>✨</div>
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ fontSize:13, fontWeight:700, color:'#fff', letterSpacing:1, textTransform:'uppercase' }}>Thư Viện Hiệu Ứng & Chuyển Động Video</span>
                <span style={{ padding:'1px 8px', borderRadius:99, background:'rgba(99,102,241,0.2)', color:'#67e8f9', fontSize:9, fontFamily:'monospace', border:'1px solid rgba(99,102,241,0.3)' }}>Remotion + Motion + Use-Gesture</span>
              </div>
              <p style={{ fontSize:11, color:'#64748b', margin:'2px 0 0' }}>Danh mục chi tiết các hiệu ứng chuyển động học, bộ lọc điện ảnh và tương tác cử chỉ</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'#64748b', cursor:'pointer', fontSize:18, lineHeight:1 }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={s.tabs}>
          <TabBtn label={`1. Kinetic Typography (${TEXT_EFFECTS.length})`}      active={tab==='text'}        onClick={() => setTab('text')}        icon="T" />
          <TabBtn label={`2. Bộ lọc & Khí quyển (${ATMOSPHERE_EFFECTS.length})`} active={tab==='atmosphere'} onClick={() => setTab('atmosphere')} icon="🎞" />
          <TabBtn label="3. Camera Physics (Rung lắc & Dolly)"                   active={tab==='camera'}      onClick={() => setTab('camera')}      icon="📷" />
          <TabBtn label="4. Cử chỉ Tương tác (@use-gesture)"                     active={tab==='gesture'}     onClick={() => setTab('gesture')}     icon="👋" />
        </div>

        {/* Body */}
        <div style={s.body}>
          {tab === 'text' && (
            <div>
              <InfoBanner icon="⚡" text="Các hiệu ứng Kinetic Typography sử dụng hệ phương trình vi phân lò xo (spring physics) của Remotion kết hợp các phép biến đổi CSS 3D để tạo chuyển động giật gân, đàn hồi và chính xác tới từng frame." />
              <div style={s.grid}>
                {TEXT_EFFECTS.map(item => (
                  <EffectCard key={item.id} item={item} isActive={segment?.motionEffect === item.id} onApply={apply} field="motionEffect" />
                ))}
              </div>
            </div>
          )}

          {tab === 'atmosphere' && (
            <div>
              <InfoBanner icon="🎞" text="Bộ lọc khí quyển Remotion chèn các lớp phủ quang học (optical overlays) theo thời gian thực với chế độ hòa trộn (blend mode), hạt nhiễu hạt phim nhựa 35mm và vệt quét ánh sáng anamorphic." />
              <div style={s.grid}>
                {ATMOSPHERE_EFFECTS.map(item => (
                  <EffectCard key={item.id} item={item} isActive={segment?.atmosphereFX === item.id} onApply={apply} field="atmosphereFX" />
                ))}
              </div>
            </div>
          )}

          {tab === 'camera' && (
            <div>
              <InfoBanner icon="📷" text="Kết hợp giữa gợi ý chuyển động máy của Google Flow Veo và thuật toán rung lắc Handheld Shake của Remotion để loại bỏ cảm giác tĩnh của hình ảnh." />
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {CAMERA_EFFECTS.map((item, i) => (
                  <div key={i} style={{ ...s.card, flexDirection:'row', alignItems:'center', justifyContent:'space-between', gap:16 }}>
                    <div>
                      <p style={{ fontSize:12, fontWeight:700, color:'#fff', margin:'0 0 4px' }}>{item.title}</p>
                      <p style={{ fontSize:11, color:'#94a3b8', margin:0, maxWidth:580, lineHeight:1.5 }}>{item.desc}</p>
                    </div>
                    {item.id === 'camera-shake' && (
                      <button onClick={() => apply('motionEffect', segment?.motionEffect === 'camera-shake' ? 'none' : 'camera-shake')}
                        style={{ padding:'6px 14px', borderRadius:99, fontSize:11, fontWeight:700, border:'none', cursor:'pointer', background: segment?.motionEffect === 'camera-shake' ? '#22d3ee' : '#6366f1', color: segment?.motionEffect === 'camera-shake' ? '#050508' : '#fff', whiteSpace:'nowrap' }}>
                        {segment?.motionEffect === 'camera-shake' ? 'Đang bật' : 'Bật Rung máy'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'gesture' && (
            <div>
              <InfoBanner icon="👋" text="Tích hợp thư viện @use-gesture/react cho phép tương tác trực tiếp lên khung hình video: kéo thả vị trí (drag), phóng to thu nhỏ bằng con lăn chuột (wheel) và xoay góc độ 360°." />
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
                {GESTURE_FEATURES.map((item, i) => (
                  <div key={i} style={{ ...s.card }}>
                    <div style={{ width:28, height:28, borderRadius:8, background:'rgba(99,102,241,0.2)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, marginBottom:8 }}>
                      {i === 0 ? '⤢' : i === 1 ? '🔍' : '↻'}
                    </div>
                    <p style={{ fontSize:12, fontWeight:700, color:'#fff', margin:'0 0 6px' }}>{item.title}</p>
                    <p style={{ fontSize:11, color:'#94a3b8', lineHeight:1.5, margin:0 }}>{item.desc}</p>
                  </div>
                ))}
              </div>
              <div style={{ marginTop:14, padding:14, borderRadius:12, background:'rgba(10,10,22,0.8)', border:'1px solid rgba(99,102,241,0.4)', display:'flex', alignItems:'center', justifyContent:'space-between', gap:16 }}>
                <div>
                  <p style={{ fontSize:12, fontWeight:700, color:'#fff', margin:'0 0 3px' }}>Kích hoạt Nhãn dán Cử chỉ tương tác (Interactive Gesture Sticker)</p>
                  <p style={{ fontSize:11, color:'#94a3b8', margin:0 }}>Thêm một nhãn dán tương tác vào cảnh hiện tại và thử kéo thả trực tiếp trên màn hình video!</p>
                </div>
                <button onClick={() => { apply('gestureSticker', { enabled:true, type:'badge', text:'FEATURED', x:50, y:35, scale:1, rotation:0, color:'#38bdf8' }); }}
                  style={{ padding:'8px 18px', borderRadius:99, background:'#22d3ee', color:'#050508', fontSize:11, fontWeight:700, border:'none', cursor:'pointer', whiteSpace:'nowrap', boxShadow:'0 0 14px rgba(6,182,212,0.4)' }}>
                  Bật Sticker Cử chỉ ngay
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={s.footer}>
          <span>Phân cảnh đang chọn: {sceneLabel}</span>
          <button onClick={onClose} style={{ padding:'5px 16px', borderRadius:99, background:'#1e1e32', color:'#fff', fontSize:11, fontWeight:600, border:'none', cursor:'pointer' }}>Đóng</button>
        </div>
      </div>
    </div>
  );
}
