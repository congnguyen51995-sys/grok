import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';

/* ── inline SVG icons ───────────────────────────────────────────────────── */
const Ic = {
  play:    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>,
  pause:   <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>,
  skipB:   <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>,
  skipF:   <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>,
  plus:    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>,
  trash:   <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>,
  folder:  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>,
  export:  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>,
  film:    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/></svg>,
  music:   <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>,
  text:    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 4v3h5.5v12h3V7H19V4H5z"/></svg>,
  image:   <svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>,
  sub:     <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z"/></svg>,
  undo:    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg>,
  redo:    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z"/></svg>,
  scissors:<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9.64 7.64c.23-.5.36-1.05.36-1.64 0-2.21-1.79-4-4-4S2 3.79 2 6s1.79 4 4 4c.59 0 1.14-.13 1.64-.36L10 12l-2.36 2.36C7.14 14.13 6.59 14 6 14c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4c0-.59-.13-1.14-.36-1.64L12 14l7 7h3v-1L9.64 7.64zM6 8c-1.1 0-2-.89-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm0 12c-1.1 0-2-.89-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm6-7.5c-.28 0-.5-.22-.5-.5s.22-.5.5-.5.5.22.5.5-.22.5-.5.5zM19 3l-6 6 2 2 7-7V3h-3z"/></svg>,
  vol:     <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>,
  mute:    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>,
  copy:    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>,
  speed:   <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.38 8.57l-1.23 1.85a8 8 0 0 1-.22 7.58H5.07A8 8 0 0 1 15.58 6.85l1.85-1.23A10 10 0 0 0 3.35 19a2 2 0 0 0 1.72 1h13.85a2 2 0 0 0 1.74-1 10 10 0 0 0-.27-10.44zm-9.79 6.84a2 2 0 0 0 2.83 0l5.66-8.49-8.49 5.66a2 2 0 0 0 0 2.83z"/></svg>,
  reverse: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6L18 6v12z"/></svg>,
  split2:  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M11 19H6.5A3.5 3.5 0 0 1 3 15.5v-7A3.5 3.5 0 0 1 6.5 5H11M13 5h4.5A3.5 3.5 0 0 1 21 8.5v7a3.5 3.5 0 0 1-3.5 3.5H13M12 3v18"/></svg>,
  warn:    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>,
  spinner: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeOpacity=".25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>,
  detach:  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 20H4V7c0-.55-.45-1-1-1s-1 .45-1 1v13c0 1.1.9 2 2 2h13c.55 0 1-.45 1-1s-.45-1-1-1zm3-16H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-1 9h-4v4h-2v-4h-4V11h4V7h2v4h4v2z"/></svg>,
  replace: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14H7v-2h5v2zm5-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>,
  freeze:  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M22 11h-4.17l3.24-3.24-1.41-1.42L15 11h-2V9l4.66-4.66-1.42-1.41L13 6.17V2h-2v4.17L7.76 2.93 6.34 4.34 11 9v2H9L4.34 6.34 2.93 7.76 6.17 11H2v2h4.17l-3.24 3.24 1.41 1.42L9 13h2v2l-4.66 4.66 1.42 1.41L11 17.83V22h2v-4.17l3.24 3.24 1.42-1.41L13 15v-2h2l4.66 4.66 1.41-1.42L17.83 13H22v-2z"/></svg>,
};
const Icon = ({ n, s = 16, style: st }) => (
  <span style={{ width: s, height: s, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...st }}>
    {React.cloneElement(Ic[n] || Ic.film, { style: { width: s, height: s } })}
  </span>
);

/* ── constants ───────────────────────────────────────────────────────────── */
const API_BASE   = 'http://localhost:9000';
const TRACK_LBL  = 96;   // px — left label width
const PX_PER_SEC = 60;
const TRACK_H    = 44;
const RULER_H    = 26;
const genId      = () => Math.random().toString(36).slice(2, 9);
const DEFAULT_SERVER = 'C:\\Users\\Vu Anh\\Desktop\\CapCutAPI-main\\CapCutAPI-main';

const TRACK_CFG = [
  { type: 'video',    label: 'Video',   color: '#00C4A3', bg: '#0a3530', icon: 'film',  multi: true  },
  { type: 'audio',    label: 'Audio',   color: '#7B61FF', bg: '#1d1640', icon: 'music', multi: true  },
  { type: 'text',     label: 'Text',    color: '#FFB800', bg: '#362a00', icon: 'text',  multi: false },
  { type: 'subtitle', label: 'Caption', color: '#5B9CF6', bg: '#0d1f42', icon: 'sub',   multi: false },
  { type: 'image',    label: 'Image',   color: '#FF6B9D', bg: '#350026', icon: 'image', multi: false },
];

const RESOLUTIONS = [
  { label: '9:16 · 1080×1920', w: 1080, h: 1920 },
  { label: '1:1 · 1080×1080',  w: 1080, h: 1080 },
  { label: '16:9 · 1920×1080', w: 1920, h: 1080 },
  { label: '3:4 · 810×1080',   w:  810, h: 1080 },
];

const TRANSITIONS = ['None','fade','dissolve','slide_left','slide_right','zoom_in','zoom_out','flash','blur'];
const MASK_TYPES  = ['None','heart','mirror','roundrect','star','rectangle','ellipse'];
const SOUND_FX    = ['None','reverb','echo','pitch_up','pitch_down','chipmunk','bass_boost','radio'];
const ANIMATIONS  = ['None','zoom_in','zoom_out','fade_in','slide_up','slide_down','bounce'];

const mk = {
  video:    () => ({ id: genId(), type: 'video',    path: '', name: 'Video',   start: 0, end: 5,  target_start: 0, speed: 1, volume: 1, transition: 'None', mask: 'None', blur: false, muted: false }),
  audio:    () => ({ id: genId(), type: 'audio',    path: '', name: 'Audio',   start: 0, end: 5,  target_start: 0, volume: 1, speed: 1, sound_effect: 'None' }),
  text:     () => ({ id: genId(), type: 'text',     text: 'New Text', name: 'Text', start: 0, end: 3, font: 'Arial', font_color: '#FFFFFF', font_size: 40, bold: false, italic: false, shadow: false, shadow_color: '#000000', bg_color: '' }),
  subtitle: () => ({ id: genId(), type: 'subtitle', path: '', srt_path: '', name: 'Caption', start: 0, end: 10, font_size: 32, font_color: '#FFFFFF', bold: false, border_width: 2, border_color: '#000000', bg_alpha: 0 }),
  image:    () => ({ id: genId(), type: 'image',    path: '', name: 'Image',   start: 0, end: 3,  target_start: 0, animation: 'None' }),
};

const fmtTime = s => {
  const m = Math.floor(s / 60), sec = (s % 60).toFixed(1);
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(4,'0')}`;
};

/* ── pickFile helper ─────────────────────────────────────────────────────── */
const pickFile = (filters, multiple = false) =>
  window.electronAPI.capcutSelectFile?.({ filters, multiple }).catch(() => multiple ? [] : null);

/* ── tiny form components ────────────────────────────────────────────────── */
const inp = { width: '100%', background: '#2a2a2a', border: '1px solid #404040', borderRadius: 6, padding: '6px 8px', color: '#fff', fontSize: 12, outline: 'none', boxSizing: 'border-box' };
const Inp = ({ val, onChange, type = 'text', ...r }) => (
  <input type={type} value={val} {...r}
    onChange={e => onChange(type === 'number' ? (parseFloat(e.target.value) || 0) : e.target.value)}
    style={{ ...inp, ...r.style }} />
);
const Sel = ({ val, opts, onChange }) => (
  <select value={val} onChange={e => onChange(e.target.value)}
    style={{ ...inp, cursor: 'pointer' }}>
    {opts.map(o => <option key={o} value={o}>{o}</option>)}
  </select>
);
const Tog = ({ val, onChange, label }) => (
  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: '#ccc', userSelect: 'none' }}>
    <div onClick={() => onChange(!val)} style={{ width: 34, height: 18, borderRadius: 9, background: val ? '#FE2C55' : '#404040', position: 'relative', transition: 'background .2s', cursor: 'pointer' }}>
      <div style={{ width: 14, height: 14, background: '#fff', borderRadius: 7, position: 'absolute', top: 2, left: val ? 18 : 2, transition: 'left .2s' }} />
    </div>
    {label}
  </label>
);
const ColorPick = ({ val, onChange }) => (
  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
    <input type="color" value={val || '#000000'} onChange={e => onChange(e.target.value)}
      style={{ width: 28, height: 28, borderRadius: 4, border: '1px solid #404040', background: 'none', cursor: 'pointer', padding: 1 }} />
    <Inp val={val} onChange={onChange} style={{ flex: 1 }} />
  </div>
);
const Fld = ({ label, ch, half }) => (
  <div style={{ marginBottom: 10, ...(half && { width: 'calc(50% - 4px)' }) }}>
    <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
    {ch}
  </div>
);

/* ── PROPERTIES PANEL ────────────────────────────────────────────────────── */
function PropsPanel({ item, onChange }) {
  if (!item) return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#333', gap: 8, padding: 20, textAlign: 'center' }}>
      <Icon n="scissors" s={28} />
      <div style={{ fontSize: 11, color: '#3a3a3a' }}>Chọn clip trên timeline để chỉnh thuộc tính</div>
    </div>
  );

  const up = (k, v) => onChange({ ...item, [k]: v });
  const cfg = TRACK_CFG.find(c => c.type === item.type);

  const FileRow = ({ field = 'path', accepts }) => (
    <Fld label={field === 'srt_path' ? 'File SRT' : 'File'} ch={
      <div style={{ display: 'flex', gap: 4 }}>
        <div style={{ flex: 1, background: '#2a2a2a', border: '1px solid #404040', borderRadius: 6, padding: '6px 8px', fontSize: 11, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item[field] || 'Chưa chọn...'}
        </div>
        <button onClick={async () => {
          const f = await pickFile([{ name: 'Files', extensions: accepts }]);
          if (f && !Array.isArray(f)) { up(field, f); up('name', f.split('\\').pop()); if (field === 'srt_path') up('path', f); }
        }} style={{ width: 28, background: '#333', border: '1px solid #404040', borderRadius: 6, cursor: 'pointer', color: '#aaa', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon n="folder" s={13} />
        </button>
      </div>
    } />
  );

  return (
    <div style={{ padding: '12px', overflowY: 'auto', flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid #2a2a2a' }}>
        <div style={{ width: 26, height: 26, borderRadius: 6, background: cfg?.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: cfg?.color }}>
          <Icon n={cfg?.icon || 'film'} s={13} />
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#ddd' }}>{cfg?.label}</span>
        <span style={{ fontSize: 10, color: '#555', marginLeft: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
      </div>

      {(item.type === 'video' || item.type === 'audio' || item.type === 'image') &&
        <FileRow accepts={item.type === 'video' ? ['mp4','mov','avi','mkv','webm'] : item.type === 'audio' ? ['mp3','wav','m4a','aac','ogg'] : ['jpg','jpeg','png','webp','gif']} />}
      {item.type === 'subtitle' && <FileRow field="srt_path" accepts={['srt','ass','vtt']} />}
      {item.type === 'text' && <Fld label="Nội dung" ch={<textarea value={item.text} onChange={e => up('text', e.target.value)} style={{ ...inp, resize: 'vertical', minHeight: 56 }} />} />}

      {item.type !== 'subtitle' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Fld label="Start (s)" half ch={<Inp val={item.start} onChange={v => up('start', v)} type="number" step={0.1} min={0} />} />
          <Fld label="End (s)" half ch={<Inp val={item.end} onChange={v => up('end', v)} type="number" step={0.1} min={0} />} />
          {(item.type === 'video' || item.type === 'audio' || item.type === 'image') && (
            <Fld label="Vị trí trên timeline (s)" ch={<Inp val={item.target_start} onChange={v => up('target_start', v)} type="number" step={0.1} min={0} />} />
          )}
        </div>
      )}

      {item.type === 'video' && (<>
        <div style={{ display: 'flex', gap: 8 }}>
          <Fld label="Tốc độ" half ch={<Inp val={item.speed} onChange={v => up('speed', v)} type="number" step={0.1} min={0.1} max={10} />} />
          <Fld label="Âm lượng" half ch={<Inp val={item.volume} onChange={v => up('volume', v)} type="number" step={0.1} min={0} max={2} />} />
        </div>
        <Fld label="Chuyển cảnh" ch={<Sel val={item.transition} opts={TRANSITIONS} onChange={v => up('transition', v)} />} />
        <Fld label="Mask" ch={<Sel val={item.mask} opts={MASK_TYPES} onChange={v => up('mask', v)} />} />
        <div style={{ marginBottom: 10 }}><Tog val={item.muted} onChange={v => up('muted', v)} label="Tắt tiếng" /></div>
        <div style={{ marginBottom: 10 }}><Tog val={item.blur} onChange={v => up('blur', v)} label="Background Blur" /></div>
      </>)}

      {item.type === 'audio' && (<>
        <div style={{ display: 'flex', gap: 8 }}>
          <Fld label="Âm lượng" half ch={<Inp val={item.volume} onChange={v => up('volume', v)} type="number" step={0.1} min={0} max={2} />} />
          <Fld label="Tốc độ" half ch={<Inp val={item.speed} onChange={v => up('speed', v)} type="number" step={0.1} min={0.1} max={3} />} />
        </div>
        <Fld label="Hiệu ứng âm thanh" ch={<Sel val={item.sound_effect} opts={SOUND_FX} onChange={v => up('sound_effect', v)} />} />
      </>)}

      {item.type === 'text' && (<>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Fld label="Font" half ch={<Inp val={item.font} onChange={v => up('font', v)} />} />
          <Fld label="Cỡ chữ" half ch={<Inp val={item.font_size} onChange={v => up('font_size', v)} type="number" step={1} min={8} max={200} />} />
        </div>
        <Fld label="Màu chữ" ch={<ColorPick val={item.font_color} onChange={v => up('font_color', v)} />} />
        <Fld label="Màu nền" ch={<ColorPick val={item.bg_color || '#00000000'} onChange={v => up('bg_color', v)} />} />
        <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
          <Tog val={item.bold} onChange={v => up('bold', v)} label="Bold" />
          <Tog val={item.italic} onChange={v => up('italic', v)} label="Italic" />
          <Tog val={item.shadow} onChange={v => up('shadow', v)} label="Shadow" />
        </div>
        {item.shadow && <Fld label="Màu shadow" ch={<ColorPick val={item.shadow_color} onChange={v => up('shadow_color', v)} />} />}
      </>)}

      {item.type === 'subtitle' && (<>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Fld label="Cỡ chữ" half ch={<Inp val={item.font_size} onChange={v => up('font_size', v)} type="number" step={1} />} />
          <Fld label="Viền (px)" half ch={<Inp val={item.border_width} onChange={v => up('border_width', v)} type="number" step={0.5} min={0} />} />
        </div>
        <Fld label="Màu chữ" ch={<ColorPick val={item.font_color} onChange={v => up('font_color', v)} />} />
        <Fld label="Màu viền" ch={<ColorPick val={item.border_color} onChange={v => up('border_color', v)} />} />
        <Fld label="Độ mờ nền (0–1)" ch={<Inp val={item.bg_alpha} onChange={v => up('bg_alpha', v)} type="number" step={0.1} min={0} max={1} />} />
        <div style={{ marginBottom: 10 }}><Tog val={item.bold} onChange={v => up('bold', v)} label="Bold" /></div>
      </>)}

      {item.type === 'image' && (
        <Fld label="Animation" ch={<Sel val={item.animation} opts={ANIMATIONS} onChange={v => up('animation', v)} />} />
      )}
    </div>
  );
}

/* ── PREVIEW AREA ────────────────────────────────────────────────────────── */
function PreviewArea({ clips, selId, resolution, playhead, onPlayheadChange, playing, onPlayingChange }) {
  const videoRefs = useRef({});
  const rafRef    = useRef(null);

  // active preview clip: selected video, or first video at playhead
  const activeClip = useMemo(() => {
    const sel = clips.find(c => c.id === selId && c.type === 'video' && c.path);
    if (sel) return sel;
    return clips.find(c => c.type === 'video' && c.path && playhead >= c.target_start && playhead <= c.target_start + (c.end - c.start));
  }, [clips, selId, playhead]);

  // refs để tránh stale closure trong RAF
  const clipsRef    = useRef(clips);
  const playheadRef = useRef(playhead);
  useEffect(() => { clipsRef.current = clips; }, [clips]);
  useEffect(() => { playheadRef.current = playhead; }, [playhead]);

  // seek khi playhead thay đổi (chỉ khi không đang play)
  useEffect(() => {
    if (playing) return;
    clips.filter(c => c.type === 'video' && c.path).forEach(c => {
      const el = videoRefs.current[c.id];
      if (!el) return;
      const localTime = playhead - (c.target_start ?? 0) + c.start;
      if (localTime >= c.start && localTime <= c.end && Math.abs(el.currentTime - localTime) > 0.05) {
        el.currentTime = localTime;
      }
    });
  }, [playhead]); // eslint-disable-line

  // play/pause khi state thay đổi
  useEffect(() => {
    const ac = clipsRef.current.find(c => c.type === 'video' && c.path &&
      playheadRef.current >= (c.target_start ?? 0) &&
      playheadRef.current <= (c.target_start ?? 0) + (c.end - c.start));
    const el = ac ? videoRefs.current[ac.id] : null;
    if (!el) return;
    if (playing) {
      const localTime = playheadRef.current - (ac.target_start ?? 0) + ac.start;
      if (Math.abs(el.currentTime - localTime) > 0.1) el.currentTime = localTime;
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [playing]);

  // RAF loop: cập nhật playhead khi đang chạy
  useEffect(() => {
    if (!playing) { cancelAnimationFrame(rafRef.current); return; }
    const tick = () => {
      const cs = clipsRef.current;
      const ph = playheadRef.current;
      const ac = cs.find(c => c.type === 'video' && c.path && ph >= (c.target_start ?? 0) && ph <= (c.target_start ?? 0) + (c.end - c.start));
      const el = ac ? videoRefs.current[ac.id] : null;
      if (el && !el.paused) {
        const newPh = (ac.target_start ?? 0) + el.currentTime - ac.start;
        playheadRef.current = newPh;
        onPlayheadChange(newPh);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing]);

  const togglePlay = () => onPlayingChange(v => !v);

  const fileUrl = (path) => path ? 'file:///' + path.replace(/\\/g, '/') : '';

  const boxRatio = resolution.w / resolution.h;

  const previewH = 210;
  const previewW = Math.round(previewH * resolution.w / resolution.h);

  return (
    <div style={{ background: '#0a0a0a', borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '10px 12px', flexShrink: 0, height: previewH + 20 }}>
      <div style={{ position: 'relative', background: '#000', borderRadius: 6, overflow: 'hidden', width: previewW, height: previewH, flexShrink: 0, border: '1px solid #2a2a2a' }}>
        {/* hidden video elements for all video clips */}
        {clips.filter(c => c.type === 'video' && c.path).map(c => (
          <video key={c.id} ref={el => { if (el) videoRefs.current[c.id] = el; else delete videoRefs.current[c.id]; }}
            src={fileUrl(c.path)} preload="auto" muted={c.muted}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: c.id === activeClip?.id ? 1 : 0, pointerEvents: 'none' }}
            onEnded={() => onPlayingChange(false)} />
        ))}

        {/* overlay: image */}
        {clips.filter(c => c.type === 'image' && c.path && playhead >= c.target_start && playhead <= c.target_start + (c.end - c.start)).map(c => (
          <img key={c.id} src={fileUrl(c.path)} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} />
        ))}

        {/* overlay: text */}
        {clips.filter(c => c.type === 'text' && playhead >= c.start && playhead <= c.end).map(c => (
          <div key={c.id} style={{ position: 'absolute', bottom: '15%', left: '50%', transform: 'translateX(-50%)', fontSize: Math.round(c.font_size * 0.3), color: c.font_color, fontFamily: c.font, fontWeight: c.bold ? 700 : 400, fontStyle: c.italic ? 'italic' : 'normal', textShadow: c.shadow ? `2px 2px 4px ${c.shadow_color}` : 'none', background: c.bg_color || 'transparent', padding: '2px 6px', borderRadius: 3, whiteSpace: 'nowrap', maxWidth: '90%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {c.text}
          </div>
        ))}

        {/* placeholder */}
        {!activeClip && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Icon n="film" s={28} style={{ color: '#2a2a2a' }} />
            <span style={{ fontSize: 10, color: '#2a2a2a' }}>{resolution.w}×{resolution.h}</span>
          </div>
        )}

        {/* play button */}
        <button onClick={togglePlay} style={{ position: 'absolute', bottom: 8, right: 8, width: 30, height: 30, borderRadius: '50%', background: 'rgba(0,0,0,.65)', border: 'none', cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
          <Icon n={playing ? 'pause' : 'play'} s={14} />
        </button>

        {/* time overlay */}
        <div style={{ position: 'absolute', top: 6, left: 8, fontSize: 10, color: '#aaa', background: 'rgba(0,0,0,.5)', borderRadius: 3, padding: '1px 5px', fontVariantNumeric: 'tabular-nums' }}>
          {fmtTime(playhead)}
        </div>
      </div>
    </div>
  );
}

/* ── CONTEXT MENU ────────────────────────────────────────────────────────── */
function ContextMenu({ menu, onAction, onClose }) {
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);

  if (!menu) return null;
  const { x, y, clipId, type } = menu;
  const items = [
    { icon: 'split2',  label: 'Tách tại playhead',  action: 'split'   },
    { icon: 'copy',    label: 'Nhân đôi',            action: 'dup'     },
    { sep: true },
    ...(type === 'video' ? [
      { icon: 'detach', label: 'Tách âm thanh',       action: 'detach'  },
      { icon: 'mute',   label: 'Tắt/bật tiếng',       action: 'mute'    },
      { icon: 'freeze', label: 'Đóng băng khung hình', action: 'freeze'  },
    ] : []),
    { icon: 'speed',   label: 'Tốc độ...',           action: 'speed'   },
    { icon: 'reverse', label: 'Đảo ngược',            action: 'reverse' },
    { icon: 'replace', label: 'Thay thế clip',        action: 'replace' },
    { sep: true },
    { icon: 'trash',   label: 'Xóa',                 action: 'delete', danger: true },
  ];

  return (
    <div onMouseDown={e => e.stopPropagation()}
      style={{ position: 'fixed', left: Math.min(x, window.innerWidth - 200), top: Math.min(y, window.innerHeight - 320), zIndex: 9999, background: '#1e1e1e', border: '1px solid #383838', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.7)', padding: '4px 0', minWidth: 196, userSelect: 'none' }}>
      {items.map((it, i) => it.sep
        ? <div key={i} style={{ height: 1, background: '#2e2e2e', margin: '3px 0' }} />
        : (
          <button key={it.action} onClick={() => { onAction(it.action, clipId); onClose(); }}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: 'none', border: 'none', padding: '7px 14px', cursor: 'pointer', color: it.danger ? '#FE2C55' : '#ddd', fontSize: 12, textAlign: 'left' }}
            onMouseEnter={e => e.currentTarget.style.background = it.danger ? '#2a0a10' : '#2e2e2e'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}>
            <Icon n={it.icon} s={14} style={{ color: it.danger ? '#FE2C55' : '#888' }} />
            {it.label}
          </button>
        )
      )}
    </div>
  );
}

/* ── SPEED MODAL ─────────────────────────────────────────────────────────── */
function SpeedModal({ clip, onSave, onClose }) {
  const [val, setVal] = useState(clip?.speed || 1);
  const presets = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 5, 10];
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#1e1e1e', border: '1px solid #333', borderRadius: 12, padding: 20, width: 300 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>⚡ Tốc độ phát</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
          {presets.map(p => (
            <button key={p} onClick={() => setVal(p)}
              style={{ padding: '4px 10px', background: val === p ? '#FE2C55' : '#2a2a2a', border: `1px solid ${val === p ? '#FE2C55' : '#404040'}`, borderRadius: 6, color: '#fff', fontSize: 11, cursor: 'pointer' }}>
              {p}×
            </button>
          ))}
        </div>
        <Inp val={val} onChange={setVal} type="number" step={0.05} min={0.1} max={100} style={{ marginBottom: 14 }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => { onSave(val); onClose(); }} style={{ flex: 1, background: '#FE2C55', border: 'none', borderRadius: 8, padding: '9px', cursor: 'pointer', color: '#fff', fontWeight: 700, fontSize: 12 }}>Áp dụng</button>
          <button onClick={onClose} style={{ padding: '9px 16px', background: '#2a2a2a', border: '1px solid #404040', borderRadius: 8, cursor: 'pointer', color: '#aaa', fontSize: 12 }}>Hủy</button>
        </div>
      </div>
    </div>
  );
}

/* ── CLIP BAR ────────────────────────────────────────────────────────────── */
function ClipBar({ clip, cfg, selected, onSelect, onUpdate, onDelete, onCtxMenu, timelineScrollLeft }) {
  const duration = clip.end - clip.start;
  const left     = (clip.target_start ?? 0) * PX_PER_SEC;
  const width    = Math.max(duration * PX_PER_SEC, 8);
  const label    = clip.type === 'text' ? (clip.text || 'Text') : (clip.name || cfg.label);

  const dragRef  = useRef(null);

  const startDrag = (e, mode) => {
    e.stopPropagation();
    e.preventDefault();
    onSelect(clip.id);
    const startX = e.clientX;
    const orig = { target_start: clip.target_start ?? 0, start: clip.start, end: clip.end };

    const onMove = (me) => {
      const dx = me.clientX - startX;
      const dt = dx / PX_PER_SEC;
      if (mode === 'move') {
        onUpdate({ target_start: Math.max(0, orig.target_start + dt) });
      } else if (mode === 'trim-left') {
        const newStart = Math.max(0, Math.min(orig.start + dt, orig.end - 0.2));
        const newTargetStart = Math.max(0, orig.target_start + (newStart - orig.start));
        onUpdate({ start: newStart, target_start: newTargetStart });
      } else if (mode === 'trim-right') {
        onUpdate({ end: Math.max(orig.start + 0.2, orig.end + dt) });
      }
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const handleColor = selected ? '#fff' : `${cfg.color}88`;

  return (
    <div
      onMouseDown={e => { if (e.button === 0 && !e.target.dataset.handle) startDrag(e, 'move'); }}
      onClick={e => { e.stopPropagation(); onSelect(clip.id); }}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onCtxMenu(e, clip.id, clip.type); }}
      style={{
        position: 'absolute', left, width, top: 4, height: TRACK_H - 8,
        background: cfg.bg, border: `1.5px solid ${selected ? '#fff' : cfg.color}`,
        borderRadius: 5, cursor: 'grab', userSelect: 'none', overflow: 'hidden',
        boxShadow: selected ? `0 0 0 1.5px ${cfg.color}55` : 'none',
        display: 'flex', alignItems: 'center',
      }}>
      {/* left trim handle */}
      <div data-handle="l" onMouseDown={e => startDrag(e, 'trim-left')}
        style={{ position: 'absolute', left: 0, top: 0, width: 7, height: '100%', background: handleColor, cursor: 'ew-resize', borderRadius: '4px 0 0 4px', zIndex: 2 }} />
      {/* label */}
      <div style={{ padding: '0 10px', display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden', flex: 1, pointerEvents: 'none' }}>
        <Icon n={cfg.icon} s={11} style={{ color: cfg.color, flexShrink: 0 }} />
        <span style={{ fontSize: 10, color: '#ddd', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
        {clip.muted && <Icon n="mute" s={10} style={{ color: '#FE2C55', flexShrink: 0 }} />}
      </div>
      {/* right trim handle */}
      <div data-handle="r" onMouseDown={e => startDrag(e, 'trim-right')}
        style={{ position: 'absolute', right: 0, top: 0, width: 7, height: '100%', background: handleColor, cursor: 'ew-resize', borderRadius: '0 4px 4px 0', zIndex: 2 }} />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════════════════════ */
export default function CapCutEditor() {
  /* server */
  const [serverPath, setServerPath] = useState(() => localStorage.getItem('capcut_srv') || DEFAULT_SERVER);
  const [serverStatus, setServerStatus] = useState('stopped');
  const [serverLog, setServerLog]   = useState([]);
  const [showSrvPanel, setShowSrvPanel] = useState(false);

  /* project */
  const [resolution, setResolution] = useState(RESOLUTIONS[0]);
  const [draftName, setDraftName]   = useState('MyDraft');
  const [draftFolder, setDraftFolder] = useState('');

  /* clips */
  const [clips, setClips] = useState([]);
  const [selId, setSelId] = useState(null);

  /* playback */
  const [playhead, setPlayhead] = useState(0);
  const [playing,  setPlaying]  = useState(false);

  /* ui state */
  const [ctxMenu,    setCtxMenu]    = useState(null);
  const [speedModal, setSpeedModal] = useState(null); // clipId
  const [showExport, setShowExport] = useState(false);
  const [exporting,  setExporting]  = useState(false);
  const [exportLog,  setExportLog]  = useState([]);
  const logRef      = useRef(null);
  const timelineRef = useRef(null);
  const rulerRef    = useRef(null);

  useEffect(() => { localStorage.setItem('capcut_srv', serverPath); }, [serverPath]);
  useEffect(() => {
    const unsub = window.electronAPI.onCapcutServerLog?.((m) => setServerLog(p => [...p.slice(-80), m.trim()]));
    window.electronAPI.capcutServerStatus?.().then(r => { if (r?.running) setServerStatus('running'); });
    return () => { try { unsub?.(); } catch {} };
  }, []);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [exportLog]);

  const addLog = useCallback((msg, type = 'info') =>
    setExportLog(p => [...p.slice(-299), { msg, type, time: new Date().toLocaleTimeString('vi') }])
  , []);

  /* derived */
  const totalDur = Math.max(30, ...clips.map(c => (c.target_start ?? 0) + (c.end - c.start) + 2));
  const totalW   = totalDur * PX_PER_SEC;
  const selectedClip = clips.find(c => c.id === selId) || null;

  /* clip helpers */
  const updateClip = (id, upd) => setClips(p => p.map(c => c.id === id ? { ...c, ...upd } : c));
  const deleteClip = (id) => { setClips(p => p.filter(c => c.id !== id)); if (selId === id) setSelId(null); };

  const addClip = async (type) => {
    if (type === 'text') { const c = mk.text(); setClips(p => [...p, c]); setSelId(c.id); return; }
    const filterMap = {
      video:    [{ name: 'Video',    extensions: ['mp4','mov','avi','mkv','webm'] }],
      audio:    [{ name: 'Audio',    extensions: ['mp3','wav','m4a','aac','ogg']  }],
      subtitle: [{ name: 'Subtitle', extensions: ['srt','ass','vtt']               }],
      image:    [{ name: 'Image',    extensions: ['jpg','jpeg','png','webp','gif'] }],
    };
    const isMulti = type !== 'subtitle';
    const res = await pickFile(filterMap[type], isMulti);
    const list = Array.isArray(res) ? res : (res ? [res] : []);
    if (!list.length) return;

    const sameType = clips.filter(c => c.type === type);
    let nextStart = sameType.length ? Math.max(...sameType.map(c => (c.target_start ?? 0) + (c.end - c.start))) : 0;

    const newClips = list.map(f => {
      const name = f.split(/[\\/]/).pop();
      const dur  = mk[type]().end - mk[type]().start;
      const c = { ...mk[type](), path: f, name, target_start: nextStart };
      if (type === 'subtitle') { c.srt_path = f; }
      nextStart += dur;
      return c;
    });
    setClips(p => [...p, ...newClips]);
    setSelId(newClips[newClips.length - 1].id);
  };

  /* context menu actions */
  const handleCtxAction = async (action, clipId) => {
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;
    switch (action) {
      case 'delete':  deleteClip(clipId); break;
      case 'dup':
        setClips(p => {
          const idx = p.findIndex(c => c.id === clipId);
          const dup = { ...clip, id: genId(), target_start: (clip.target_start ?? 0) + (clip.end - clip.start) };
          const next = [...p]; next.splice(idx + 1, 0, dup); return next;
        });
        break;
      case 'mute':    updateClip(clipId, { muted: !clip.muted }); break;
      case 'reverse': updateClip(clipId, { reversed: !clip.reversed }); break;
      case 'speed':   setSpeedModal(clipId); break;
      case 'split': {
        const clipStart = clip.target_start ?? 0;
        const localPh   = playhead - clipStart + clip.start;
        if (localPh <= clip.start + 0.1 || localPh >= clip.end - 0.1) break;
        const left  = { ...clip, end: localPh };
        const right = { ...clip, id: genId(), start: localPh, target_start: clipStart + (localPh - clip.start) };
        setClips(p => { const i = p.findIndex(c => c.id === clipId); const n = [...p]; n.splice(i, 1, left, right); return n; });
        break;
      }
      case 'detach': {
        if (clip.type !== 'video' || !clip.path) break;
        const audioClip = { ...mk.audio(), path: clip.path, name: clip.name + ' (audio)', target_start: clip.target_start ?? 0, start: clip.start, end: clip.end };
        setClips(p => [...p, audioClip]);
        updateClip(clipId, { muted: true });
        break;
      }
      case 'replace': {
        const filters = { video: [{ name: 'Video', extensions: ['mp4','mov','avi','mkv','webm'] }], audio: [{ name: 'Audio', extensions: ['mp3','wav','m4a','aac','ogg'] }], image: [{ name: 'Image', extensions: ['jpg','jpeg','png','webp','gif'] }] }[clip.type];
        if (!filters) break;
        const f = await pickFile(filters);
        if (f && !Array.isArray(f)) updateClip(clipId, { path: f, name: f.split(/[\\/]/).pop(), ...(clip.type === 'subtitle' ? { srt_path: f } : {}) });
        break;
      }
    }
  };

  /* server */
  const startServer = async () => {
    setServerStatus('starting');
    const r = await window.electronAPI.capcutStartServer?.({ serverPath });
    setServerStatus(r?.success ? 'running' : 'error');
  };

  /* API */
  const apiCall = (ep, body) =>
    fetch(`${API_BASE}/${ep}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(r => { if (!r.ok) return r.text().then(t => Promise.reject(new Error(`${ep} ${r.status}: ${t}`))); return r.json(); });

  const doExport = async () => {
    if (serverStatus !== 'running') { addLog('⚠️ Cần khởi động server!', 'error'); return; }
    setExporting(true); setExportLog([]);
    try {
      addLog(`📐 Tạo draft "${draftName}" ${resolution.w}×${resolution.h}…`);
      const { draft_id } = await apiCall('create_draft', { width: resolution.w, height: resolution.h });
      addLog(`✅ Draft ID: ${draft_id}`, 'success');
      const g = t => clips.filter(c => c.type === t);
      for (const v of g('video')) {
        if (!v.path) { addLog(`⚠️ Video "${v.name}": chưa chọn file`); continue; }
        addLog(`🎬 ${v.name}`);
        await apiCall('add_video', { draft_id, video_url: v.path, start: v.start, end: v.end, target_start: v.target_start ?? 0, speed: v.speed, volume: v.muted ? 0 : v.volume, ...(v.transition !== 'None' && { transition: v.transition }), ...(v.mask !== 'None' && { mask_type: v.mask }), background_blur: v.blur });
        addLog(`  ✅`, 'success');
      }
      for (const a of g('audio')) {
        if (!a.path) { addLog(`⚠️ Audio "${a.name}": chưa chọn file`); continue; }
        addLog(`🎵 ${a.name}`);
        await apiCall('add_audio', { draft_id, audio_url: a.path, start: a.start, end: a.end, target_start: a.target_start ?? 0, volume: a.volume, speed: a.speed, ...(a.sound_effect !== 'None' && { sound_effects: [a.sound_effect] }) });
        addLog(`  ✅`, 'success');
      }
      for (const t of g('text')) {
        if (!t.text?.trim()) continue;
        addLog(`🔤 "${t.text.slice(0,20)}"`);
        await apiCall('add_text', { draft_id, text: t.text, start: t.start, end: t.end, font: t.font, font_color: t.font_color, font_size: t.font_size, bold: t.bold, italic: t.italic, shadow_enabled: t.shadow, ...(t.shadow && { shadow_color: t.shadow_color }), ...(t.bg_color && { background_color: t.bg_color }) });
        addLog(`  ✅`, 'success');
      }
      for (const s of g('subtitle')) {
        if (!s.srt_path) { addLog(`⚠️ Caption: chưa chọn SRT`); continue; }
        addLog(`📝 ${s.name}`);
        await apiCall('add_subtitle', { draft_id, srt_path: s.srt_path, font_size: s.font_size, font_color: s.font_color, bold: s.bold, border_width: s.border_width, border_color: s.border_color, background_alpha: s.bg_alpha });
        addLog(`  ✅`, 'success');
      }
      for (const img of g('image')) {
        if (!img.path) { addLog(`⚠️ Image "${img.name}": chưa chọn`); continue; }
        addLog(`🖼️ ${img.name}`);
        await apiCall('add_image', { draft_id, image_url: img.path, start: img.start, end: img.end, target_start: img.target_start ?? 0, ...(img.animation !== 'None' && { animations: [img.animation] }) });
        addLog(`  ✅`, 'success');
      }
      addLog('💾 Lưu draft…');
      const sv = await apiCall('save_draft', { draft_id, draft_name: draftName.trim(), ...(draftFolder && { draft_folder: draftFolder }) });
      addLog(`🎉 Xong: ${sv.draft_path || draftName}`, 'success');
    } catch(e) { addLog('❌ ' + e.message, 'error'); }
    finally { setExporting(false); }
  };

  /* ── Ruler drag for playhead ────────────────────────────────────────── */
  const seekFromRuler = useCallback((clientX) => {
    const rect = rulerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = clientX - rect.left - TRACK_LBL + (timelineRef.current?.scrollLeft || 0);
    setPlayhead(Math.max(0, x / PX_PER_SEC));
    setPlaying(false);
  }, []);

  const onRulerMouseDown = (e) => {
    if (e.button !== 0) return;
    seekFromRuler(e.clientX);
    const onMove = (me) => seekFromRuler(me.clientX);
    const onUp   = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  /* ── build track rows ────────────────────────────────────────────────── */
  const trackRows = useMemo(() => {
    const rows = [];
    TRACK_CFG.forEach(cfg => {
      const typeClips = clips.filter(c => c.type === cfg.type);
      if (cfg.multi) {
        // group by "layer" — naive: each clip gets its own sub-row to avoid overlap
        const layers = [];
        typeClips.forEach(clip => {
          const start = (clip.target_start ?? 0);
          const end   = start + (clip.end - clip.start);
          let placed = false;
          for (const layer of layers) {
            const hasOverlap = layer.some(lc => {
              const ls = lc.target_start ?? 0; const le = ls + (lc.end - lc.start);
              return start < le && end > ls;
            });
            if (!hasOverlap) { layer.push(clip); placed = true; break; }
          }
          if (!placed) layers.push([clip]);
        });
        layers.forEach((layer, li) =>
          rows.push({ cfg, clips: layer, label: li === 0 ? cfg.label : `${cfg.label} ${li + 1}`, isOverlay: li > 0 })
        );
        if (typeClips.length === 0) rows.push({ cfg, clips: [], label: cfg.label, isOverlay: false });
      } else {
        rows.push({ cfg, clips: typeClips, label: cfg.label, isOverlay: false });
      }
    });
    return rows;
  }, [clips]);

  const statusDot = { stopped: '#555', starting: '#FFB800', running: '#00C4A3', error: '#FE2C55' };

  /* ─────────────────────────────────────────────────────────────────────── */
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#141414', color: '#fff', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', overflow: 'hidden', userSelect: 'none' }}>

      {/* ── HEADER ────────────────────────────────────────────────────── */}
      <div style={{ height: 48, background: '#1a1a1a', borderBottom: '1px solid #252525', display: 'flex', alignItems: 'center', padding: '0 10px', gap: 6, flexShrink: 0 }}>
        <button title="Undo" onClick={() => {}} style={HDR_BTN}><Icon n="undo" s={15} /></button>
        <button title="Redo" onClick={() => {}} style={HDR_BTN}><Icon n="redo" s={15} /></button>
        <div style={{ width: 1, height: 22, background: '#303030', margin: '0 2px' }} />
        <input value={draftName} onChange={e => setDraftName(e.target.value)}
          style={{ background: 'transparent', border: 'none', outline: 'none', color: '#ddd', fontSize: 13, fontWeight: 600, minWidth: 0, width: 130 }} />
        <select value={`${resolution.w}x${resolution.h}`}
          onChange={e => setResolution(RESOLUTIONS.find(r => `${r.w}x${r.h}` === e.target.value) || RESOLUTIONS[0])}
          style={{ background: '#232323', border: '1px solid #333', borderRadius: 6, color: '#bbb', fontSize: 11, padding: '4px 8px', outline: 'none', cursor: 'pointer' }}>
          {RESOLUTIONS.map(r => <option key={`${r.w}x${r.h}`} value={`${r.w}x${r.h}`}>{r.label}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        {/* server pill */}
        <button onClick={() => setShowSrvPanel(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#232323', border: '1px solid #2e2e2e', borderRadius: 20, padding: '4px 10px', cursor: 'pointer', color: '#bbb', fontSize: 11 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: statusDot[serverStatus] }} />
          API Server
        </button>
        <button onClick={() => setShowExport(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#FE2C55', border: 'none', borderRadius: 8, padding: '7px 15px', cursor: 'pointer', color: '#fff', fontSize: 12, fontWeight: 700 }}>
          <Icon n="export" s={13} /> Xuất Draft
        </button>
      </div>

      {/* ── SERVER DROPDOWN ───────────────────────────────────────────── */}
      {showSrvPanel && (
        <>
          <div onClick={() => setShowSrvPanel(false)} style={{ position: 'fixed', inset: 0, zIndex: 198 }} />
          <div onMouseDown={e => e.stopPropagation()} style={{ position: 'absolute', top: 50, right: 10, zIndex: 200, width: 390, background: '#1e1e1e', border: '1px solid #333', borderRadius: 10, boxShadow: '0 10px 36px rgba(0,0,0,.7)', padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>⚙️ CapCutAPI Server</div>
            <div style={{ fontSize: 11, color: '#777', marginBottom: 4 }}>Thư mục CapCutAPI (chứa capcut_server.py)</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              <input value={serverPath} onChange={e => setServerPath(e.target.value)}
                style={{ flex: 1, background: '#2a2a2a', border: '1px solid #404040', borderRadius: 6, padding: '6px 8px', color: '#fff', fontSize: 12, outline: 'none' }} />
              <button onClick={async () => { const f = await window.electronAPI.selectFolder?.(); if (f) setServerPath(f); }}
                style={{ width: 30, background: '#2e2e2e', border: '1px solid #404040', borderRadius: 6, cursor: 'pointer', color: '#aaa', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon n="folder" s={13} />
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {serverStatus !== 'running'
                ? <button onClick={startServer} disabled={serverStatus === 'starting'}
                    style={{ flex: 1, background: '#00C4A3', border: 'none', borderRadius: 7, padding: 9, cursor: 'pointer', color: '#000', fontWeight: 700, fontSize: 12, opacity: serverStatus === 'starting' ? 0.5 : 1 }}>
                    {serverStatus === 'starting' ? '○ Đang khởi động…' : '▶ Khởi động Server'}
                  </button>
                : <button onClick={async () => { await window.electronAPI.capcutStopServer?.(); setServerStatus('stopped'); }}
                    style={{ flex: 1, background: '#2a2a2a', border: '1px solid #FE2C55', borderRadius: 7, padding: 9, cursor: 'pointer', color: '#FE2C55', fontWeight: 700, fontSize: 12 }}>
                    ■ Dừng Server
                  </button>
              }
              <button onClick={() => setShowSrvPanel(false)} style={{ padding: '9px 14px', background: '#2a2a2a', border: '1px solid #404040', borderRadius: 7, cursor: 'pointer', color: '#888', fontSize: 12 }}>Đóng</button>
            </div>
            {serverLog.length > 0 && (
              <div style={{ marginTop: 10, background: '#0a0a0a', borderRadius: 6, padding: 8, maxHeight: 90, overflowY: 'auto', fontFamily: 'monospace', fontSize: 10, color: '#00C4A3' }}>
                {serverLog.slice(-15).map((l, i) => <div key={i}>{l}</div>)}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── MAIN BODY ─────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* LEFT: add-media buttons */}
        <div style={{ width: 68, background: '#1a1a1a', borderRight: '1px solid #222', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 0', gap: 5, flexShrink: 0 }}>
          {TRACK_CFG.map(cfg => (
            <button key={cfg.type} onClick={() => addClip(cfg.type)} title={`+ ${cfg.label}`}
              style={{ width: 52, height: 52, background: '#222', border: '1px solid #2e2e2e', borderRadius: 10, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3 }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = cfg.color; e.currentTarget.style.background = cfg.bg; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#2e2e2e'; e.currentTarget.style.background = '#222'; }}>
              <Icon n={cfg.icon} s={18} style={{ color: cfg.color }} />
              <span style={{ fontSize: 9, color: '#666' }}>{cfg.label}</span>
            </button>
          ))}
        </div>

        {/* CENTER: preview + timeline */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Preview */}
          <PreviewArea clips={clips} selId={selId} resolution={resolution} playhead={playhead}
            onPlayheadChange={setPlayhead} playing={playing} onPlayingChange={setPlaying} />

          {/* Playback controls */}
          <div style={{ background: '#1a1a1a', borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', gap: 4, padding: '3px 10px', flexShrink: 0 }}>
            <button style={CTRL_BTN} onClick={() => setPlayhead(0)}><Icon n="skipB" s={14} /></button>
            <button style={CTRL_BTN} onClick={() => setPlaying(v => !v)}><Icon n={playing ? 'pause' : 'play'} s={16} /></button>
            <button style={CTRL_BTN} onClick={() => setPlayhead(p => Math.min(p + 0.1, totalDur))}><Icon n="skipF" s={14} /></button>
            <span style={{ fontSize: 11, color: '#888', marginLeft: 6, fontVariantNumeric: 'tabular-nums', minWidth: 64 }}>{fmtTime(playhead)}</span>
            <div style={{ flex: 1 }} />
            <button style={CTRL_BTN} title="Split at playhead" onClick={() => { if (selId) handleCtxAction('split', selId); }}><Icon n="scissors" s={13} /></button>
            <button style={CTRL_BTN}><Icon n="vol" s={14} /></button>
          </div>

          {/* TIMELINE */}
          <div ref={timelineRef} onClick={() => setSelId(null)}
            style={{ flex: 1, overflowX: 'auto', overflowY: 'auto', background: '#111', position: 'relative', cursor: 'default' }}>
            <div style={{ minWidth: totalW + TRACK_LBL + 80, paddingBottom: 16 }}>

              {/* RULER */}
              <div ref={rulerRef} onMouseDown={onRulerMouseDown}
                style={{ position: 'sticky', top: 0, zIndex: 20, height: RULER_H, background: '#1a1a1a', borderBottom: '1px solid #252525', cursor: 'col-resize', display: 'flex' }}>
                {/* ruler label gutter */}
                <div style={{ width: TRACK_LBL, flexShrink: 0, background: '#1e1e1e', borderRight: '1px solid #252525' }} />
                {/* tick marks */}
                <div style={{ position: 'relative', flex: 1 }}>
                  {Array.from({ length: Math.ceil(totalDur) + 1 }).map((_, i) => (
                    <div key={i} style={{ position: 'absolute', left: i * PX_PER_SEC, top: 0, height: '100%', borderLeft: '1px solid #2a2a2a' }}>
                      <span style={{ fontSize: 9, color: '#505050', paddingLeft: 3, lineHeight: `${RULER_H}px`, display: 'block', pointerEvents: 'none', fontVariantNumeric: 'tabular-nums' }}>{i}s</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* PLAYHEAD */}
              <div style={{ position: 'absolute', left: TRACK_LBL + playhead * PX_PER_SEC, top: 0, bottom: 0, width: 1, background: '#FE2C55', zIndex: 30, pointerEvents: 'none' }}>
                <div style={{ width: 9, height: 9, background: '#FE2C55', borderRadius: '50%', marginLeft: -4, marginTop: RULER_H - 4 }} />
              </div>

              {/* TRACKS */}
              {trackRows.map((row, ri) => (
                <div key={ri} style={{ display: 'flex', height: TRACK_H, borderBottom: '1px solid #181818' }}>
                  {/* track label */}
                  <div style={{ width: TRACK_LBL, flexShrink: 0, background: '#1a1a1a', borderRight: '1px solid #222', display: 'flex', alignItems: 'center', paddingLeft: 8, gap: 5, zIndex: 5 }}>
                    {row.isOverlay
                      ? <span style={{ fontSize: 9, color: '#444', paddingLeft: 10 }}>↳ {row.label}</span>
                      : <>
                          <Icon n={row.cfg.icon} s={11} style={{ color: row.cfg.color }} />
                          <span style={{ fontSize: 10, color: '#606060', flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{row.label}</span>
                          <button onClick={e => { e.stopPropagation(); addClip(row.cfg.type); }}
                            style={{ width: 16, height: 16, background: '#252525', border: `1px solid ${row.cfg.color}44`, borderRadius: 4, cursor: 'pointer', color: row.cfg.color, display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 4, flexShrink: 0 }}>
                            <Icon n="plus" s={10} />
                          </button>
                        </>
                    }
                  </div>
                  {/* clip area */}
                  <div style={{ position: 'relative', flex: 1 }}>
                    {row.clips.map(clip => (
                      <ClipBar key={clip.id} clip={clip} cfg={row.cfg}
                        selected={selId === clip.id}
                        onSelect={setSelId}
                        onUpdate={upd => updateClip(clip.id, upd)}
                        onDelete={() => deleteClip(clip.id)}
                        onCtxMenu={(e, id, type) => setCtxMenu({ x: e.clientX, y: e.clientY, clipId: id, type })} />
                    ))}
                  </div>
                </div>
              ))}

              {clips.length === 0 && (
                <div style={{ position: 'absolute', left: TRACK_LBL + 60, top: RULER_H + 60, color: '#2a2a2a', pointerEvents: 'none', textAlign: 'center' }}>
                  <div style={{ fontSize: 28 }}>🎬</div>
                  <div style={{ fontSize: 12, marginTop: 6 }}>Nhấn icon bên trái để thêm clip</div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT: properties */}
        <div style={{ width: 238, background: '#1a1a1a', borderLeft: '1px solid #222', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <div style={{ padding: '9px 12px', borderBottom: '1px solid #252525', fontSize: 10, fontWeight: 700, color: '#505050', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Properties
          </div>
          <PropsPanel item={selectedClip} onChange={upd => updateClip(selId, upd)} />
        </div>
      </div>

      {/* ── CONTEXT MENU ──────────────────────────────────────────────── */}
      {ctxMenu && (
        <ContextMenu menu={ctxMenu} onAction={handleCtxAction} onClose={() => setCtxMenu(null)} />
      )}

      {/* ── SPEED MODAL ───────────────────────────────────────────────── */}
      {speedModal && (
        <SpeedModal clip={clips.find(c => c.id === speedModal)}
          onSave={v => updateClip(speedModal, { speed: v })}
          onClose={() => setSpeedModal(null)} />
      )}

      {/* ── EXPORT MODAL ──────────────────────────────────────────────── */}
      {showExport && (
        <>
          <div onClick={() => { if (!exporting) setShowExport(false); }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', zIndex: 400 }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 401, width: 460, background: '#1e1e1e', border: '1px solid #333', borderRadius: 14, boxShadow: '0 20px 60px rgba(0,0,0,.8)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 18px', borderBottom: '1px solid #272727', display: 'flex', alignItems: 'center', gap: 10 }}>
              <Icon n="export" s={16} />
              <span style={{ fontSize: 14, fontWeight: 700 }}>Xuất sang CapCut</span>
              <div style={{ flex: 1 }} />
              {!exporting && <button onClick={() => setShowExport(false)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>}
            </div>
            <div style={{ padding: 18 }}>
              {/* summary */}
              <div style={{ background: '#252525', borderRadius: 8, padding: 12, marginBottom: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 20px' }}>
                {TRACK_CFG.map(cfg => { const n = clips.filter(c => c.type === cfg.type).length; return (
                  <div key={cfg.type} style={{ fontSize: 11, display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#555' }}>{cfg.label}</span>
                    <span style={{ color: n > 0 ? cfg.color : '#333', fontWeight: 600 }}>{n}</span>
                  </div>
                ); })}
                <div style={{ fontSize: 11, display: 'flex', justifyContent: 'space-between', gridColumn: '1/-1', marginTop: 6, paddingTop: 8, borderTop: '1px solid #333' }}>
                  <span style={{ color: '#555' }}>Độ phân giải</span>
                  <span style={{ color: '#bbb' }}>{resolution.w}×{resolution.h}</span>
                </div>
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>Tên Draft</div>
                <Inp val={draftName} onChange={setDraftName} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>Thư mục (để trống = mặc định)</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Inp val={draftFolder} onChange={setDraftFolder} style={{ flex: 1 }} />
                  <button onClick={async () => { const f = await window.electronAPI.selectFolder?.(); if (f) setDraftFolder(f); }}
                    style={{ width: 30, background: '#2e2e2e', border: '1px solid #404040', borderRadius: 6, cursor: 'pointer', color: '#aaa', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon n="folder" s={13} />
                  </button>
                </div>
              </div>
              {serverStatus !== 'running' && (
                <div style={{ background: '#2a1800', border: '1px solid #5c3800', borderRadius: 7, padding: 10, marginBottom: 12, fontSize: 11, color: '#FFB800', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Icon n="warn" s={14} /> Server chưa chạy. Nhấn "API Server" ở header.
                </div>
              )}
              <button onClick={doExport} disabled={exporting || serverStatus !== 'running'}
                style={{ width: '100%', background: exporting || serverStatus !== 'running' ? '#2a2a2a' : '#FE2C55', border: 'none', borderRadius: 9, padding: 12, cursor: exporting || serverStatus !== 'running' ? 'not-allowed' : 'pointer', color: exporting || serverStatus !== 'running' ? '#444' : '#fff', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                {exporting ? '○ Đang xuất…' : '↓ Xuất sang CapCut'}
              </button>
              {exportLog.length > 0 && (
                <div ref={logRef} style={{ marginTop: 10, background: '#0a0a0a', borderRadius: 7, padding: 10, maxHeight: 140, overflowY: 'auto', fontFamily: 'monospace', fontSize: 10 }}>
                  {exportLog.map((e, i) => (
                    <div key={i} style={{ color: e.type === 'success' ? '#00C4A3' : e.type === 'error' ? '#FE2C55' : '#888', paddingBottom: 2 }}>
                      <span style={{ color: '#333' }}>{e.time} </span>{e.msg}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ── style constants ─────────────────────────────────────────────────────── */
const HDR_BTN  = { width: 30, height: 30, background: 'none', border: 'none', color: '#888', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };
const CTRL_BTN = { width: 28, height: 28, background: 'none', border: 'none', color: '#888', borderRadius: 5, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };
