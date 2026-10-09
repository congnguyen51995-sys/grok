/**
 * Kho chủ đề kênh Quân sự — sinh tổ hợp từ danh mục vũ khí thật × mẫu câu (~2000 chủ đề).
 * Chủ đề đã làm video được lưu localStorage → không lặp lại cho tới khi dùng hết nhóm.
 * Cố ý không đưa xung đột đang diễn ra / chủ đề nhạy cảm chính trị vào kho tự động.
 */

const CLASSES = {
  fighter:    { label: 'tiêm kích',              criteria: 'tàng hình, radar, tốc độ, tầm bay, vũ khí, giá thành' },
  tank:       { label: 'xe tăng chủ lực',         criteria: 'giáp bảo vệ, hỏa lực, cơ động, hệ thống điều khiển hỏa lực' },
  airdef:     { label: 'hệ thống phòng không',    criteria: 'tầm bắn, radar, khả năng đánh chặn tên lửa, cơ động, giá thành' },
  attackheli: { label: 'trực thăng tấn công',     criteria: 'vũ khí, giáp, cảm biến, tốc độ' },
  bomber:     { label: 'máy bay ném bom',         criteria: 'tầm bay, tải trọng, tàng hình, tốc độ', noRegional: true },
  carrier:    { label: 'tàu sân bay',             criteria: 'lượng giãn nước, số máy bay mang theo, động lực, cách phóng máy bay', navy: true },
  sub:        { label: 'tàu ngầm',                criteria: 'độ êm, vũ khí, động lực, độ sâu lặn', navy: true },
  destroyer:  { label: 'tàu khu trục',            criteria: 'số ống phóng tên lửa, radar, phòng không, chống ngầm', navy: true },
  drone:      { label: 'máy bay không người lái', criteria: 'thời gian bay, tầm hoạt động, tải trọng vũ khí, giá thành' },
  rocketarty: { label: 'pháo phản lực phóng loạt', criteria: 'tầm bắn, số ống phóng, độ chính xác, thời gian nạp đạn, cơ động' },
  howitzer:   { label: 'lựu pháo',                 criteria: 'tầm bắn, tốc độ bắn, độ chính xác, cơ động' },
  missile:    { label: 'tên lửa hành trình',      criteria: 'tầm bắn, tốc độ, độ chính xác, khả năng xuyên phòng không' },
  atgm:       { label: 'vũ khí bộ binh vác vai',  criteria: 'tầm bắn, khả năng xuyên giáp, dẫn đường, trọng lượng' },
  ifv:        { label: 'xe chiến đấu bộ binh',    criteria: 'giáp, hỏa lực, sức chở quân, cơ động' },
  transport:  { label: 'máy bay vận tải quân sự', criteria: 'tải trọng, tầm bay, yêu cầu đường băng' },
  heli:       { label: 'trực thăng vận tải',      criteria: 'sức chở, tầm bay, độ bền' },
};

// [tên, quốc gia]
const CATALOG = {
  fighter: [['F-35 Lightning II','Mỹ'],['F-22 Raptor','Mỹ'],['F-15EX Eagle II','Mỹ'],['F-16 Fighting Falcon','Mỹ'],['F/A-18E/F Super Hornet','Mỹ'],
    ['Su-57','Nga'],['Su-35','Nga'],['Su-30','Nga'],['MiG-29','Nga'],['MiG-31','Nga'],['J-20','Trung Quốc'],['J-10C','Trung Quốc'],['J-16','Trung Quốc'],
    ['Rafale','Pháp'],['Eurofighter Typhoon','châu Âu'],['JAS 39 Gripen','Thụy Điển'],['KF-21 Boramae','Hàn Quốc'],['HAL Tejas','Ấn Độ'],['Mitsubishi F-2','Nhật Bản']],
  tank: [['M1 Abrams','Mỹ'],['Leopard 2','Đức'],['Challenger 2','Anh'],['Challenger 3','Anh'],['T-90','Nga'],['T-72','Nga'],['T-14 Armata','Nga'],
    ['Leclerc','Pháp'],['Merkava Mk.4','Israel'],['K2 Black Panther','Hàn Quốc'],['Type 99','Trung Quốc'],['Type 10','Nhật Bản'],['Arjun','Ấn Độ']],
  airdef: [['Patriot','Mỹ'],['THAAD','Mỹ'],['NASAMS','Na Uy'],['Iron Dome','Israel'],["David's Sling",'Israel'],['IRIS-T SLM','Đức'],['SAMP/T','Pháp và Ý'],
    ['S-300','Nga'],['S-400','Nga'],['S-500','Nga'],['Buk','Nga'],['Pantsir-S1','Nga'],['Tor-M2','Nga'],['HQ-9','Trung Quốc']],
  attackheli: [['AH-64 Apache','Mỹ'],['AH-1Z Viper','Mỹ'],['Ka-52','Nga'],['Mi-28','Nga'],['Eurocopter Tiger','châu Âu'],['Z-10','Trung Quốc'],['T129 ATAK','Thổ Nhĩ Kỳ']],
  bomber: [['B-52 Stratofortress','Mỹ'],['B-1B Lancer','Mỹ'],['B-2 Spirit','Mỹ'],['B-21 Raider','Mỹ'],['Tu-160','Nga'],['Tu-95','Nga'],['Tu-22M3','Nga'],['H-6','Trung Quốc']],
  carrier: [['tàu sân bay lớp Gerald R. Ford','Mỹ'],['tàu sân bay lớp Nimitz','Mỹ'],['tàu sân bay HMS Queen Elizabeth','Anh'],['tàu sân bay Charles de Gaulle','Pháp'],
    ['tàu sân bay Phúc Kiến','Trung Quốc'],['tàu sân bay Sơn Đông','Trung Quốc'],['tàu sân bay Admiral Kuznetsov','Nga'],['tàu sân bay INS Vikrant','Ấn Độ'],['tàu sân bay Cavour','Ý']],
  sub: [['tàu ngầm lớp Virginia','Mỹ'],['tàu ngầm lớp Seawolf','Mỹ'],['tàu ngầm lớp Ohio','Mỹ'],['tàu ngầm lớp Columbia','Mỹ'],['tàu ngầm lớp Yasen','Nga'],
    ['tàu ngầm lớp Borei','Nga'],['tàu ngầm lớp Kilo','Nga'],['tàu ngầm lớp Astute','Anh'],['tàu ngầm Type 212','Đức'],['tàu ngầm lớp Taigei','Nhật Bản'],['tàu ngầm Type 094','Trung Quốc']],
  destroyer: [['khu trục hạm lớp Arleigh Burke','Mỹ'],['khu trục hạm lớp Zumwalt','Mỹ'],['khu trục hạm Type 055','Trung Quốc'],['khu trục hạm Type 052D','Trung Quốc'],
    ['khu trục hạm lớp Sejong Đại đế','Hàn Quốc'],['khu trục hạm lớp Maya','Nhật Bản'],['khu trục hạm Type 45 Daring','Anh'],['khinh hạm FREMM','Pháp và Ý'],['khinh hạm lớp Admiral Gorshkov','Nga']],
  drone: [['MQ-9 Reaper','Mỹ'],['MQ-1C Gray Eagle','Mỹ'],['RQ-4 Global Hawk','Mỹ'],['Bayraktar TB2','Thổ Nhĩ Kỳ'],['Bayraktar Akinci','Thổ Nhĩ Kỳ'],
    ['Wing Loong II','Trung Quốc'],['Shahed-136','Iran'],['Orion','Nga'],['Heron TP','Israel']],
  rocketarty: [['HIMARS','Mỹ'],['M270 MLRS','Mỹ'],['BM-21 Grad','Nga'],['BM-30 Smerch','Nga'],['TOS-1A','Nga'],['K239 Chunmoo','Hàn Quốc'],['PULS','Israel']],
  howitzer: [['M777','Mỹ'],['M109A7 Paladin','Mỹ'],['PzH 2000','Đức'],['K9 Thunder','Hàn Quốc'],['CAESAR','Pháp'],['Archer','Thụy Điển'],['2S19 Msta-S','Nga'],['PLZ-05','Trung Quốc']],
  missile: [['Tomahawk','Mỹ'],['JASSM','Mỹ'],['Harpoon','Mỹ'],['Storm Shadow','Anh và Pháp'],['Naval Strike Missile','Na Uy'],['BrahMos','Ấn Độ và Nga'],
    ['Kalibr','Nga'],['Kh-101','Nga'],['Zircon','Nga'],['Kinzhal','Nga']],
  atgm: [['Javelin','Mỹ'],['TOW','Mỹ'],['Stinger','Mỹ'],['NLAW','Anh và Thụy Điển'],['Spike','Israel'],['Carl Gustaf','Thụy Điển'],['Kornet','Nga'],['Igla','Nga']],
  ifv: [['M2 Bradley','Mỹ'],['Stryker','Mỹ'],['CV90','Thụy Điển'],['Puma','Đức'],['Boxer','Đức và Hà Lan'],['Lynx KF41','Đức'],['K21','Hàn Quốc'],['BMP-3','Nga'],['Patria AMV','Phần Lan']],
  transport: [['C-17 Globemaster III','Mỹ'],['C-130J Super Hercules','Mỹ'],['C-5 Galaxy','Mỹ'],['A400M Atlas','châu Âu'],['Il-76','Nga'],['Y-20','Trung Quốc'],['Kawasaki C-2','Nhật Bản']],
  heli: [['CH-47 Chinook','Mỹ'],['UH-60 Black Hawk','Mỹ'],['V-22 Osprey','Mỹ'],['Mi-17','Nga'],['Mi-26','Nga'],['NH90','châu Âu']],
};

const HISTORY_EVENTS = [
  'Trận Midway 1942', 'Cuộc đổ bộ Normandy 1944', 'Trận Kursk 1943, trận đánh xe tăng lớn nhất lịch sử', 'Chiến dịch Bão táp Sa mạc 1991',
  'Trận chiến nước Anh 1940', 'Trận Stalingrad', 'Trận vịnh Leyte 1944, trận hải chiến lớn nhất lịch sử', 'Cuộc không vận Berlin 1948–1949',
  'Khủng hoảng tên lửa Cuba 1962', 'Chiến tranh Falklands 1982', 'Chiến dịch Market Garden 1944', 'Trận El Alamein', 'Trận Trân Châu Cảng 1941',
  'Chiến dịch Bagration 1944', 'Trận Iwo Jima 1945', 'Trận Okinawa 1945', 'Trận đổ bộ Inchon 1950', 'Chiến dịch giải cứu con tin Entebbe 1976',
  'Cuộc chạy đua vũ trang thời Chiến tranh Lạnh', 'Sự ra đời của radar trong Thế chiến II', 'Máy bay phản lực chiến đấu đầu tiên Me 262',
  'Hạm đội tàu ngầm U-boat trong Thế chiến II', 'Thiết giáp hạm Yamato, chiến hạm lớn nhất từng được đóng', 'Thiết giáp hạm Bismarck',
  'Vụ máy bay trinh sát U-2 bị bắn hạ năm 1960', 'Máy bay trinh sát SR-71 Blackbird', 'Máy bay tàng hình đầu tiên F-117 Nighthawk', 'Cầu hàng không tiếp tế trong Thế chiến II qua dãy Himalaya',
];

const EXERCISES = ['RIMPAC','Balikatan','Red Flag','Cobra Gold','Talisman Sabre','BALTOPS','Steadfast Defender','Cold Response','Ulchi Freedom Shield',
  'Malabar','Pitch Black','African Lion','Northern Edge','Valiant Shield','Keen Sword','Trident Juncture','Garuda Shield','Sea Breeze'];

const EXERCISE_EXTRA = [
  'Tổng hợp các cuộc tập trận quân sự lớn nhất tháng này và ý nghĩa chiến lược',
  'Tập trận bắn đạn thật HIMARS: một đợt phóng rocket được chuẩn bị ra sao',
  'Tập trận đổ bộ của Thủy quân lục chiến: từ tàu lên bờ trong vài phút',
  'Tập trận nhảy dù quy mô lớn: hàng trăm lính dù cùng rời máy bay',
  'Diễn tập tác chiến trong giá lạnh Bắc Cực',
  'Tập trận tiếp nhiên liệu trên không quy mô lớn',
  'Tập trận phòng không: đánh chặn mục tiêu bay giả lập như thế nào',
  'Tập trận săn tàu ngầm: trò chơi mèo vờn chuột dưới đáy biển',
  'Hậu cần tập trận: đưa hàng nghìn tấn khí tài ra thao trường',
  'Tập trận tác chiến đô thị: huấn luyện chiến đấu trong thành phố',
  'Tập trận rà phá thủy lôi',
  'Elephant Walk: vì sao hàng chục máy bay lăn bánh cùng lúc trên đường băng',
  'Tập trận tìm kiếm cứu nạn trên biển',
  'Tập trận tác chiến điện tử: cuộc chiến vô hình trên sóng radio',
  'Huấn luyện phi công chiến đấu: từ tân binh đến phi công tiêm kích',
  'Tập trận hải quân đa quốc gia: hàng chục chiến hạm phối hợp ra sao',
];

const NAVY_EXTRA = [
  'Một ngày trên tàu sân bay Mỹ: 5.000 thủy thủ vận hành thành phố nổi như thế nào',
  'Máy bay hạ cánh trên tàu sân bay bằng cáp hãm: vì sao đây là cú hạ cánh khó nhất',
  'Nhóm tác chiến tàu sân bay gồm những tàu nào và bảo vệ nhau ra sao',
  'Tiếp tế trên biển: hai con tàu chạy song song để truyền nhiên liệu như thế nào',
  'Tàu rà phá thủy lôi: công việc nguy hiểm nhất trên biển',
  'Đặc nhiệm SEAL của Hải quân Mỹ được huấn luyện khắc nghiệt ra sao',
  'Tuần duyên làm gì và khác hải quân như thế nào',
  'Máy bay tuần tra săn ngầm P-8 Poseidon tìm tàu ngầm bằng cách nào',
  'Tàu đổ bộ tấn công lớp America: tàu sân bay thu nhỏ của Thủy quân lục chiến',
  'Sonar hoạt động thế nào: nghe thấy tàu ngầm cách hàng chục km',
  'Hệ thống phóng thẳng đứng VLS: vì sao chiến hạm hiện đại mang hàng trăm tên lửa',
  'Máy phóng điện từ EMALS trên tàu sân bay thay thế máy phóng hơi nước ra sao',
  'Tàu ngầm hạt nhân ở dưới nước hàng tháng liền bằng cách nào',
  'Cuộc sống trong tàu ngầm: không ánh mặt trời suốt nhiều tháng',
  'Tàu không người lái trên biển: tương lai của hải quân',
  'Tàu phá băng quân sự: mở đường qua Bắc Cực',
  'Vì sao tàu sân bay cần cả một đội tàu hộ tống',
  'Cảng quân sự lớn nhất thế giới hoạt động ra sao',
];

const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function buildGroups() {
  const year = new Date().getFullYear();
  const g = { compare: [], explain: [], top: [], navy: [], history: [], exercise: [] };

  for (const [cls, items] of Object.entries(CATALOG)) {
    const { label, criteria, navy, noRegional } = CLASSES[cls];

    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const [a, ca] = items[i], [b, cb] = items[j];
        const origin = ca === cb ? `cùng đến từ ${ca}` : `của ${ca} và ${cb}`;
        const t = (i + j) % 3;
        g.compare.push(
          t === 0 ? `So sánh ${a} và ${b}: ${label} nào mạnh hơn? Phân tích ${criteria}` :
          t === 1 ? `${cap(a)} vs ${b}: đối đầu giữa hai ${label} ${origin}` :
                    `Nếu ${a} đối đầu ${b}, bên nào có lợi thế? So sánh ${criteria}`);
      }
    }

    const target = navy ? g.navy : g.explain;
    for (const [a, c] of items) {
      target.push(
        `${cap(a)} hoạt động như thế nào? Giải mã ${label} của ${c}`,
        `Điểm mạnh và điểm yếu của ${a}`,
        `5 sự thật ít người biết về ${a}`,
        `Giá của ${a} là bao nhiêu? Chi phí mua và vận hành`,
        `Những quốc gia nào đang sử dụng ${a} và vì sao họ chọn nó`,
      );
      g.history.push(`Lịch sử phát triển ${a}: từ bản thiết kế đến biên chế`);
    }

    g.top.push(
      `Top 5 ${label} mạnh nhất thế giới hiện nay`,
      `Top 5 ${label} hiện đại nhất năm ${year}`,
      `Top 5 ${label} đắt nhất thế giới`,
      `Top 5 ${label} được nhiều quốc gia sử dụng nhất`,
      `Top 5 ${label} đáng gờm nhất trong lịch sử`,
      `Top 10 ${label} nổi bật nhất thế giới`,
    );
    if (!noRegional) {
      g.top.push(
        `Top 5 ${label} nổi bật nhất châu Á`,
        `Top 5 ${label} nổi bật nhất châu Âu`,
        `Top 5 quốc gia sở hữu nhiều ${label} nhất`,
      );
    }
    g.history.push(`Lịch sử ${label}: từ thế hệ đầu tiên đến hiện đại`);
  }

  for (const e of HISTORY_EVENTS) {
    g.history.push(`${e}: diễn biến và bài học quân sự`, `Vì sao ${e} thay đổi lịch sử quân sự`);
  }
  for (const x of EXERCISES) {
    g.exercise.push(
      `Tập trận ${x} là gì và các nước diễn tập những gì`,
      `Tập trận ${x} năm ${year}: có gì mới`,
      `Hậu trường tập trận ${x}: hậu cần cho hàng nghìn binh sĩ`,
    );
  }
  g.exercise.push(...EXERCISE_EXTRA);
  g.navy.push(...NAVY_EXTRA);

  for (const k of Object.keys(g)) g[k] = [...new Set(g[k])];
  return g;
}

const GROUPS = buildGroups();

export const MILITARY_IDEAS = [
  { id: 'compare',  icon: '⚔️', label: 'So sánh' },
  { id: 'explain',  icon: '🔍', label: 'Giải mã vũ khí' },
  { id: 'top',      icon: '🏆', label: 'Top 5' },
  { id: 'navy',     icon: '🚢', label: 'Hải quân' },
  { id: 'history',  icon: '📜', label: 'Lịch sử' },
  { id: 'exercise', icon: '📰', label: 'Tin tập trận' },
].map(i => ({ ...i, topics: GROUPS[i.id] }));

export const MILITARY_TOPIC_TOTAL = MILITARY_IDEAS.reduce((n, i) => n + i.topics.length, 0);

const USED_KEY = 'fluxy_mil_used';
const loadUsed = () => { try { return new Set(JSON.parse(localStorage.getItem(USED_KEY) || '[]')); } catch (_) { return new Set(); } };
const saveUsed = (set) => { try { localStorage.setItem(USED_KEY, JSON.stringify([...set])); } catch (_) {} };

// Đã hiện trong phiên này (chưa chắc đã làm) → tránh bấm liên tục ra lại chủ đề vừa thấy
const shownThisSession = new Set();

export function pickMilitaryTopic(idea) {
  const used = loadUsed();
  let pool = idea.topics.filter(t => !used.has(hash(t)) && !shownThisSession.has(t));
  if (pool.length === 0) pool = idea.topics.filter(t => !used.has(hash(t)));
  if (pool.length === 0) {
    // Đã làm hết nhóm này → mở lại cả nhóm
    idea.topics.forEach(t => used.delete(hash(t)));
    saveUsed(used);
    pool = idea.topics;
  }
  const topic = pool[Math.floor(Math.random() * pool.length)];
  shownThisSession.add(topic);
  return topic;
}

// Gọi khi thực sự bắt đầu làm video — ghi nhận chủ đề đã dùng
export function markMilitaryTopicUsed(text) {
  const t = String(text || '').trim();
  if (!t) return;
  const used = loadUsed();
  used.add(hash(t));
  saveUsed(used);
}

export function countUsedMilitaryTopics() {
  const used = loadUsed();
  return MILITARY_IDEAS.reduce((n, i) => n + i.topics.filter(t => used.has(hash(t))).length, 0);
}
