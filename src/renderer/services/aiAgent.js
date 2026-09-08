/**
 * AI Agent Service — Gemini function-calling tool definitions & executor
 */
import { GoogleGenAI } from '@google/genai';

export const TOOL_DECLARATIONS = [
  {
    name: 'plan_video',
    description: 'Lập kế hoạch sản xuất video chi tiết gồm các phân cảnh, loại visual, narration, thời lượng và ước tính chi phí',
    parameters: {
      type: 'OBJECT',
      properties: {
        title:             { type: 'STRING' },
        description:       { type: 'STRING' },
        total_duration_sec:{ type: 'NUMBER' },
        format:            { type: 'STRING', enum: ['16:9','9:16','1:1'] },
        style:             { type: 'STRING' },
        visual_distribution: {
          type: 'OBJECT',
          description: 'Tỷ lệ % các loại visual (tổng ~100)',
          properties: {
            broll:          { type: 'NUMBER' },
            ai_video:       { type: 'NUMBER' },
            ai_image:       { type: 'NUMBER' },
            illustration:   { type: 'NUMBER' },
            graphic:        { type: 'NUMBER' },
            chart:          { type: 'NUMBER' },
            motion_graphic: { type: 'NUMBER' },
            text:           { type: 'NUMBER' },
          },
        },
        segments: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              id:           { type: 'NUMBER' },
              narration:    { type: 'STRING', description: 'Lời thoại tự nhiên, phù hợp để đọc thành tiếng' },
              visual_type:  {
                type: 'STRING',
                enum: ['broll','ai_video','ai_image','illustration','graphic','chart','motion_graphic','text'],
                description: 'Loại visual. broll=video stock thực tế; ai_video=video AI Veo (hành động, chuyển động); ai_image=ảnh AI Ken Burns (concept, trừu tượng); illustration=infographic nhân vật AI-rendered; graphic=infographic dữ liệu; chart=biểu đồ thống kê; motion_graphic=đồ họa chuyển động; text=hook/transition/CTA card',
              },
              broll_query:  { type: 'STRING', description: 'Từ khóa tìm/tạo B-roll (tiếng Anh, chỉ cần khi visual_type=broll hoặc ai_video)' },
              broll_media:  { type: 'STRING', enum: ['image','video'], description: 'Chế độ B-roll cho cảnh này (chỉ dùng khi mode=auto). image=ảnh AI Ken Burns (khái niệm, chân dung, abstract); video=video AI Veo (hành động, chuyển động, cảnh thực tế)' },
              visual_prompt:{ type: 'STRING', description: 'Prompt tạo ảnh AI (chỉ cần khi visual_type=ai_image)' },
              ai_video_prompt: { type: 'STRING', description: 'Prompt tạo video AI Veo (chỉ cần khi visual_type=ai_video). Mô tả chuyển động rõ ràng: "chef cooking in kitchen", "camera tracking shot left"' },
              visual_motion:{ type: 'STRING', enum: ['slow_zoom','ken_burns','pan_right','static','zoom_out'] },
              transition_type: {
                type: 'STRING',
                enum: ['fade','slide_left','slide_right','slide_up','slide_down','zoom_in','zoom_out','cut','whip','glitch','blur'],
                description: 'Kiểu chuyển cảnh. AI TỰ CHỌN theo nhịp: fade=cảm xúc/chậm; slide_left/right=liệt kê/step; slide_up=reveal/narrative; zoom_in=nhấn mạnh; zoom_out=reveal rộng; cut=fast TikTok; whip=năng động cao; glitch=tech/digital/dramatic; blur=dream/abstract. Documentary→fade. Short→cut/whip. Dramatic reveal→glitch.',
              },
              graphic_template: { type: 'STRING', enum: ['default','stat_card','percentage_bar'], description: 'Template infographic (khi visual_type=graphic)' },
              graphic_data: {
                type: 'OBJECT',
                description: 'Dữ liệu cho graphic template',
                properties: {
                  label:   { type: 'STRING' },
                  heading: { type: 'STRING' },
                  subtext: { type: 'STRING' },
                  icon:    { type: 'STRING' },
                  values:  { type: 'ARRAY', items: { type: 'NUMBER' } },
                  labels:  { type: 'ARRAY', items: { type: 'STRING' } },
                  items:   { type: 'ARRAY', items: { type: 'OBJECT', properties: { label: { type: 'STRING' }, value: { type: 'NUMBER' } } } },
                },
              },
              text_heading:  { type: 'STRING', description: 'Tiêu đề lớn cho TextScene (khi visual_type=text)' },
              visual_accent: { type: 'STRING', description: 'Màu accent hex cho nền text/graphic, ví dụ "#f97316". AI TỰ CHỌN phù hợp nội dung.' },
              visual_icon:   { type: 'STRING', description: 'Emoji/icon trang trí cho cảnh text/graphic, ví dụ "💰" hay "🧠". AI TỰ CHỌN.' },
              duration_sec:  { type: 'NUMBER' },
              caption:       { type: 'STRING' },
            },
            required: ['id','narration','visual_type','duration_sec'],
          },
        },
        character_description: {
          type: 'STRING',
          description: 'Mô tả ngoại hình nhân vật chính (tiếng Anh). PHẢI điền khi video có nhân vật chính. QUAN TRỌNG: ethnicity/appearance PHẢI khớp ngôn ngữ đầu ra & bối cảnh nội dung: lang=vi → Vietnamese/Southeast Asian appearance, Vietnamese setting; lang=en → American/Western appearance, Western setting; lang=ja → Japanese appearance; lang=ko → Korean appearance. Nếu có ảnh tham chiếu → mô tả từ ảnh (ưu tiên). Nếu không → sáng tạo phù hợp. Chi tiết: gender, age, ethnicity, hair, skin tone, clothing style, build.',
        },
        cost_estimate: {
          type: 'OBJECT',
          properties: {
            tts_chars:  { type: 'NUMBER' },
            ai_images:  { type: 'NUMBER' },
            broll_count:{ type: 'NUMBER' },
            approx_min: { type: 'NUMBER' },
          },
        },
      },
      required: ['title','total_duration_sec','format','segments'],
    },
  },

  {
    name: 'acquire_broll',
    description: 'Tạo ảnh AI (Imagen, broll_media=image) hoặc video AI (Veo, broll_media=video). Gọi cho MỌI cảnh visual trong tất cả chế độ (auto/video/image). VIDEO MODE: luôn tạo video Veo, không cần truyền broll_media. AUTO MODE: broll_media BẮT BUỘC (image hoặc video). IMAGE MODE: luôn tạo ảnh Imagen. KHÔNG dùng generate_image.',
    parameters: {
      type: 'OBJECT',
      properties: {
        segment_id:  { type: 'NUMBER' },
        query:       { type: 'STRING', description: 'Mô tả cảnh cần (tiếng Anh, ngắn gọn): "wealthy businessman office", "stock market trading floor"' },
        duration_sec:{ type: 'NUMBER', description: 'Thời lượng cần (giây)' },
        broll_media: { type: 'STRING', enum: ['image','video'], description: 'Khi mode=auto: chọn image (ảnh AI + Ken Burns, cho cảnh abstract/chân dung/concept) hoặc video (Veo AI, cho cảnh hành động/chuyển động/thực tế). Bỏ trống nếu không ở auto mode.' },
      },
      required: ['segment_id','query'],
    },
  },

  {
    name: 'generate_tts',
    description: 'Tạo file audio TTS từ đoạn narration của một phân cảnh. Voice đã được cấu hình sẵn bởi người dùng, không cần truyền.',
    parameters: {
      type: 'OBJECT',
      properties: {
        segment_id: { type: 'NUMBER' },
        text:       { type: 'STRING' },
        speed: {
          type: 'NUMBER',
          description: 'Tốc độ đọc: 0.7=chậm rãi nghiêm túc, 1.0=bình thường, 1.2=nhanh energetic, 1.4=rất nhanh (TikTok). AI tự quyết theo mood cảnh.',
        },
        emotion: {
          type: 'STRING',
          enum: ['calm','excited','serious','dramatic','gentle','energetic'],
          description: 'Cảm xúc giọng đọc: calm=điềm tĩnh, excited=hào hứng, serious=nghiêm túc, dramatic=kịch tính, gentle=nhẹ nhàng, energetic=đầy năng lượng. AI tự chọn phù hợp preset/nội dung.',
        },
      },
      required: ['segment_id','text'],
    },
  },

  {
    name: 'generate_image',
    description: 'Tạo ảnh minh họa cho phân cảnh có visual_type=ai_image (chỉ dùng khi mode=AI Image, KHÔNG dùng trong auto mode). Gemini tự viết code Remotion JSX → renderStill ra PNG sát nghĩa nhất với nội dung cảnh.',
    parameters: {
      type: 'OBJECT',
      properties: {
        segment_id: { type: 'NUMBER' },
        prompt:     { type: 'STRING', description: 'Mô tả visual muốn tạo (tiếng Anh, chi tiết)' },
        narration:  { type: 'STRING', description: 'Lời thoại đầy đủ của cảnh này — dùng để tạo illustration sát nội dung nhất' },
        topic:      { type: 'STRING', description: 'Chủ đề ngắn gọn của cảnh (tiếng Việt OK), ví dụ: "Tâm lý học tiền bạc"' },
        style:      { type: 'STRING', description: 'Visual style: modern dark, cinematic, minimal white, vibrant gradient, etc.' },
      },
      required: ['segment_id','prompt'],
    },
  },

  {
    name: 'render_video',
    description: 'Render video cuối cùng bằng Remotion sau khi đã xử lý xong TTS, B-roll và ảnh',
    parameters: {
      type: 'OBJECT',
      properties: {
        output_filename: { type: 'STRING', description: 'Tên file .mp4' },
      },
      required: ['output_filename'],
    },
  },

  {
    name: 'search_stock_footage',
    description: 'Tìm kiếm video stock thực tế từ Pexels/Pixabay cho phân cảnh. Dùng khi cần footage chất lượng cao (con người thật, địa điểm thật, sự kiện). Ưu tiên hơn AI-generated broll khi cần thực tế.',
    parameters: {
      type: 'OBJECT',
      properties: {
        segment_id:  { type: 'NUMBER' },
        query:       { type: 'STRING', description: 'Từ khóa tìm kiếm tiếng Anh, cụ thể: "businessman walking office", "city traffic night", "happy family outdoor"' },
        duration_sec:{ type: 'NUMBER' },
        provider:    { type: 'STRING', enum: ['pexels','pixabay','both'], description: 'Nguồn stock video, default "both"' },
      },
      required: ['segment_id','query'],
    },
  },

  {
    name: 'add_background_music',
    description: 'Thêm nhạc nền vào video để tăng cảm xúc và giữ chân người xem. Gọi TRƯỚC render_video. Nhạc nền quan trọng đặc biệt cho YouTube/TikTok/Facebook.',
    parameters: {
      type: 'OBJECT',
      properties: {
        mood:    { type: 'STRING', enum: ['upbeat','dramatic','calm','inspiring','mysterious','cinematic','emotional','corporate','epic','lofi'], description: 'Tone nhạc phù hợp nội dung' },
        volume:  { type: 'NUMBER', description: 'Âm lượng 0.05–0.25. Default 0.12. Không quá to để không lấn giọng đọc.' },
        genre:   { type: 'STRING', description: 'Thể loại nhạc gợi ý: "ambient electronic", "orchestral", "acoustic guitar"...' },
      },
      required: ['mood'],
    },
  },

  {
    name: 'set_platform_config',
    description: 'Cấu hình target platform và chiến lược engagement. Gọi NGAY SAU plan_video để tối ưu toàn bộ quy trình.',
    parameters: {
      type: 'OBJECT',
      properties: {
        platform:      { type: 'STRING', enum: ['youtube','tiktok','facebook','shorts','instagram'], description: 'Platform đăng tải chính' },
        hook_strategy: { type: 'STRING', description: 'Chiến lược hook đầu video: "question_hook", "shocking_stat", "bold_claim", "story_hook", "before_after"' },
        pacing:        { type: 'STRING', enum: ['fast','medium','slow'], description: 'Nhịp cắt cảnh: fast(TikTok/Shorts), medium(YouTube), slow(documentary)' },
        target_audience: { type: 'STRING', description: 'Đối tượng khán giả mục tiêu' },
        cta_text:      { type: 'STRING', description: 'Lời kêu gọi hành động cuối video (như, subscribe, comment...)' },
      },
      required: ['platform'],
    },
  },

  {
    name: 'research_topic',
    description: 'Nghiên cứu chủ đề: thu thập facts, số liệu, dẫn chứng thực tế từ Gemini. GỌI TRƯỚC plan_video khi cần video có nội dung chuyên sâu, thống kê, dẫn chứng. Giúp script có chiều sâu và đáng tin cậy hơn.',
    parameters: {
      type: 'OBJECT',
      properties: {
        topic:  { type: 'STRING', description: 'Chủ đề cần nghiên cứu, ví dụ: "tại sao người giàu càng giàu" hoặc "compound interest psychology"' },
        depth:  { type: 'STRING', enum: ['quick','deep'], description: 'quick=5 điểm chính; deep=15+ facts có số liệu cụ thể, có thể dùng làm graphic' },
        focus:  { type: 'STRING', description: 'Khía cạnh cụ thể cần tập trung, vd: "tâm lý học", "số liệu kinh tế", "ví dụ thực tế"' },
        lang:   { type: 'STRING', enum: ['vi','en'], description: 'Ngôn ngữ trả về. Default vi.' },
      },
      required: ['topic'],
    },
  },

  {
    name: 'add_sfx',
    description: 'Thêm SFX vào video tại timestamp. Có thể gọi nhiều lần. SFX tăng impact, engagement. Gọi sau plan_video, trước render_video.',
    parameters: {
      type: 'OBJECT',
      properties: {
        sfx_id: {
          type: 'STRING',
          enum: [
            // transitions
            'whoosh_01','whoosh_02','whoosh_03',
            'reverse_whoosh_01','reverse_whoosh_02',
            'riser_01','riser_02','downlifter_01',
            'pop_01','pop_02',
            // impacts
            'impact_01','impact_02','impact_03',
            'deep_hit_01','deep_hit_02',
            'bass_drop_01','metal_hit_01','metal_hit_02',
            // cinematic
            'drone_01','drone_02',
            'heartbeat_01','heartbeat_02',
            'mechanical_01','mechanical_02',
            'page_01','paper_01',
            // tech
            'glitch_01','glitch_02',
            'buzz_01','buzz_02',
            'scan_01','typing_01','focus_01','shutter_01',
            // nature
            'wind_01','rain_01','thunder_01','fire_01','water_01','birds_01',
            // ui
            'click_01','click_02','double_click_01',
            'beep_01','beep_02',
            'success_01','error_01','confirm_01','notification_01','tick_01',
          ],
          description: 'ID SFX. Chọn theo cảm xúc/context:\n- Chuyển cảnh nhanh: whoosh_01/02, pop_01/02\n- Cảnh reveal/bí mật: reverse_whoosh_01, riser_01\n- Hook đầu video: impact_02, bass_drop_01\n- Cảnh số liệu/thống kê: impact_01, tick_01\n- Tech/AI content: glitch_01, scan_01, buzz_01\n- Cảnh cảm xúc mạnh: heartbeat_01, drone_01\n- Documentary/lịch sử: page_01, drone_02\n- Kết thúc/CTA: downlifter_01, success_01\n- Thiên nhiên/môi trường: birds_01, rain_01, wind_01',
        },
        at_sec:      { type: 'NUMBER', description: 'Timestamp phát SFX (giây từ đầu video). Tính theo tổng thời lượng các segment trước đó.' },
        volume:      { type: 'NUMBER', description: 'Âm lượng 0.0–1.0, default 0.65' },
        duration_sec:{ type: 'NUMBER', description: 'Giới hạn thời lượng phát (giây). Để trống = phát hết file gốc.' },
        description: { type: 'STRING', description: 'Lý do chọn SFX này (dùng để log)' },
      },
      required: ['sfx_id', 'at_sec'],
    },
  },

  {
    name: 'quality_check',
    description: 'Kiểm tra chất lượng video sau render_video. Đánh giá: narration-visual matching, caption accuracy, pacing, music balance. Tự phát hiện vấn đề và đề xuất fix.',
    parameters: {
      type: 'OBJECT',
      properties: {
        check_items: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Danh sách hạng mục kiểm tra: ["visual_match","caption","pacing","audio_balance","hook_strength"]',
        },
        auto_fix: { type: 'BOOLEAN', description: 'Nếu true, tự động fix các vấn đề nhỏ mà không hỏi. Default true.' },
      },
      required: [],
    },
  },

  {
    name: 'generate_seo',
    description: 'Tạo SEO metadata YouTube/TikTok: tiêu đề hấp dẫn (max 100 chars), mô tả đầy đủ với timestamps, tags và hashtags. Gọi sau render_video hoàn thành.',
    parameters: {
      type: 'OBJECT',
      properties: {
        platform: { type: 'STRING', enum: ['youtube','tiktok','facebook','shorts'], description: 'Platform đăng tải, default youtube' },
        lang:     { type: 'STRING', description: 'Ngôn ngữ: vi, en. Default vi' },
      },
      required: [],
    },
  },

  {
    name: 'generate_thumbnail',
    description: 'Tạo ảnh thumbnail YouTube 16:9 (1920×1080) cực thu hút: sinh ảnh nhân vật/cảnh bằng Imagen AI rồi composite với text bold, badge, gradient overlay qua Remotion. Gọi sau generate_seo.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title:              { type: 'STRING', description: 'Tiêu đề nổi bật (ngắn, gây shock/tò mò, max 10 từ tiếng Việt)' },
        highlight:          { type: 'STRING', description: 'Từ/cụm từ nổi bật màu accent (ví dụ: "90%", "Bí Mật", "Miễn Phí", "VIRAL"). Ngắn, impact cao.' },
        badge:              { type: 'STRING', description: 'Badge tag trên đầu (ví dụ: "🔥 MỚI NHẤT", "💰 SỰ THẬT", "⚠️ CẢNH BÁO"). Tùy chọn.' },
        character_prompt:   { type: 'STRING', description: 'Mô tả nhân vật/cảnh cho Imagen3 (tiếng Anh): kiểu người, cảm xúc, phục trang, nền. Ví dụ: "Vietnamese man shocked expression pointing finger, dark dramatic background, cinematic lighting, 8k"' },
        layout:             { type: 'STRING', enum: ['character_right','character_left','character_center','no_character'], description: 'Vị trí nhân vật. character_right: text trái + nhân vật phải (phổ biến nhất). character_left: ngược lại.' },
        accent_color:       { type: 'STRING', description: 'Màu accent hex (#f97316 cam, #ef4444 đỏ, #22d3ee cyan, #a78bfa tím, #fbbf24 vàng). Tự chọn phù hợp chủ đề.' },
        bg_gradient:        { type: 'STRING', description: 'CSS gradient nền (nếu không có nhân vật). Ví dụ: "linear-gradient(135deg,#0a0015,#1a0030)"' },
      },
      required: ['title', 'character_prompt'],
    },
  },

  {
    name: 'cleanup_output',
    description: 'Dọn dẹp file tạm sau khi video hoàn thành. Giữ lại: video cuối, SEO .txt, thumbnail .png. Xóa: file TTS, broll tạm, render trung gian.',
    parameters: {
      type: 'OBJECT',
      properties: {
        confirm: { type: 'BOOLEAN', description: 'Luôn truyền true để xác nhận xóa' },
      },
      required: [],
    },
  },
];

// ── Build Remotion edit-plan.json from accumulated project state ──────────────
export function buildEditPlan(plan, assets) {
  const fps = 30;
  let currentFrame = 0;

  const segments = (plan.segments || []).map(seg => {
    const asset = assets[seg.id] || {};
    const durationSec = asset.ttsDuration
      ? (asset.ttsDuration + 0.5)
      : (seg.duration_sec || 5);
    const durationFrames = Math.max(30, Math.round(durationSec * fps));
    const startFrame = currentFrame;
    currentFrame += durationFrames;

    // Build visual object based on plan type + acquired assets.
    // RULE: if a real visual asset exists, ALWAYS use it — even if visual_type='text'/'graphic'.
    // This ensures generate_image/acquire_broll results are attached to the timeline.
    let visual;
    const hasRealAsset = !!(asset.brollFile || asset.imagePath);
    const isTextOnlyType = ['text', 'graphic', 'chart', 'motion_graphic'].includes(seg.visual_type);

    if (hasRealAsset && isTextOnlyType) {
      // Asset was generated for a text/graphic scene — promote to real visual
      visual = asset.brollFile
        ? { type: 'broll', file: asset.brollFile, duration: asset.brollDuration, zoom: 1.08, brightness: 0.82, motion: seg.visual_motion || 'slow_zoom' }
        : { type: 'ai_image', file: asset.imagePath, motion: seg.visual_motion || 'ken_burns', zoom: 1.07 };
    } else {
      switch (seg.visual_type) {
        case 'broll':
          if (asset.brollFile) {
            visual = { type: 'broll', file: asset.brollFile, duration: asset.brollDuration, zoom: 1.08, brightness: 0.82, motion: seg.visual_motion || 'slow_zoom' };
          } else if (asset.imagePath) {
            visual = { type: 'ai_image', file: asset.imagePath, motion: seg.visual_motion || 'ken_burns', zoom: 1.07 };
          } else {
            visual = { type: 'text', heading: '', subtext: seg.narration || '' };
          }
          break;
        case 'ai_image':
          visual = asset.imagePath
            ? { type: 'ai_image', file: asset.imagePath, motion: seg.visual_motion || 'ken_burns', zoom: 1.07 }
            : { type: 'text', heading: '', subtext: seg.narration || '' };
          break;
        case 'ai_video':
          visual = asset.brollFile
            ? { type: 'broll', file: asset.brollFile, duration: asset.brollDuration, zoom: 1.05, brightness: 0.88, motion: seg.visual_motion || 'slow_zoom' }
            : asset.imagePath
            ? { type: 'ai_image', file: asset.imagePath, motion: seg.visual_motion || 'ken_burns' }
            : { type: 'text', heading: '', subtext: seg.narration || '' };
          break;
        case 'illustration':
          // When a pre-rendered PNG exists, use ai_image so RemixerVideo renders the actual file.
          // IllustrationScene ignores v.file — only used when we have JSON data but no PNG.
          visual = asset.imagePath
            ? { type: 'ai_image', file: asset.imagePath, motion: seg.visual_motion || 'ken_burns', zoom: 1.07 }
            : seg.graphic_data && Object.keys(seg.graphic_data).length > 0
            ? { type: 'illustration', data: seg.graphic_data }
            : { type: 'text', heading: seg.text_heading || '', subtext: seg.narration || '' };
          break;
        case 'graphic':
          visual = {
            type: 'graphic',
            template: seg.graphic_template || 'default',
            data: seg.graphic_data || {
              heading: seg.text_heading || '',
              subtext: seg.narration || '',
              icon: seg.visual_icon || '📊',
            },
            ...(seg.visual_accent ? { accent: seg.visual_accent } : {}),
          };
          break;
        case 'chart':
          visual = {
            type: 'graphic',
            template: 'percentage_bar',
            data: seg.graphic_data || { heading: seg.text_heading || '', subtext: seg.narration || '' },
            ...(seg.visual_accent ? { accent: seg.visual_accent } : {}),
          };
          break;
        case 'motion_graphic':
          visual = {
            type: 'graphic',
            template: seg.graphic_template || 'stat_card',
            data: seg.graphic_data || { heading: seg.text_heading || '', subtext: seg.narration || '' },
            ...(seg.visual_accent ? { accent: seg.visual_accent } : {}),
          };
          break;
        case 'text':
          visual = {
            type: 'text',
            heading: seg.text_heading || '',
            subtext: seg.narration || '',
            ...(seg.visual_accent ? { accent: seg.visual_accent } : {}),
            ...(seg.visual_icon   ? { icon:   seg.visual_icon }   : {}),
          };
          break;
        default:
          visual = asset.brollFile
            ? { type: 'broll', file: asset.brollFile, zoom: 1.08, brightness: 0.85 }
            : asset.imagePath
            ? { type: 'ai_image', file: asset.imagePath, motion: 'ken_burns' }
            : { type: 'text', heading: '', subtext: seg.narration || '' };
      }
    }

    const narration = asset.ttsFile
      ? { text: seg.narration || '', file: asset.ttsFile, durationSec: asset.ttsDuration }
      : { text: seg.narration || '' };

    return {
      id: seg.id,
      startFrame,
      durationFrames,
      visual,
      narration,
      caption: seg.caption || seg.narration || '',
      transition: seg.transition_type || 'fade',
    };
  });

  const [width, height] =
    plan.format === '9:16' ? [1080, 1920]
    : plan.format === '1:1' ? [1080, 1080]
    : [1920, 1080];

  // SFX: normalize at_sec field
  const sfxList = (plan.sfxList || []).map(s => ({
    ...s,
    at_sec: s.at_sec ?? s.at ?? 0,
    at: undefined,
  }));

  return {
    project: { title: plan.title || 'AI Video', fps, width, height, totalFrames: currentFrame, preset: plan.preset || plan.style || 'auto' },
    segments,
    sfxList,
    bgMusic: plan.bgMusic || null,
  };
}

// ── Execute a single tool call from Gemini ────────────────────────────────────
export async function executeTool(toolName, args, { apiKeys, model = 'gemini-2.5-flash', voice, ttsProvider = 'edge', brollMode = 'image', veoModel = 'Veo 3.1 - Lite [Lower Priority]', outputDir, vieNeuSavedVoices = [], projectState, refImagePaths = [], onAsset = null, manualSfxList = [] }) {
  const api = window.electronAPI;
  const segId = args.segment_id ?? 0;

  switch (toolName) {

    case 'plan_video': {
      projectState.plan = args;
      if (!projectState.assetRegistry) projectState.assetRegistry = {};
      // Save character description for injection into all subsequent prompts
      if (args.character_description) {
        projectState.characterDescription = args.character_description;
      }

      // Auto-generate canonical character portrait when no user ref images
      // This ensures character consistency even without a user-provided reference photo
      if (args.character_description && refImagePaths.length === 0 && !projectState.canonicalCharacterImage) {
        try {
          // character_description already contains correct ethnicity/culture guided by system prompt + lang
          const portraitPrompt = `portrait photo of ${args.character_description}, professional studio photography, face clearly visible, neutral background, high quality, cinematic lighting, photorealistic`;
          onAsset?.({ type: 'image', segId: 9998, label: '🎭 Đang tạo ảnh nhân vật chính...' });
          const portraitResult = await api.agentAcquireBroll({
            query: portraitPrompt,
            segmentId: 9998,
            durationSec: 5,
            mode: 'image',
            veoModel,
            refImagePaths: [],
          });
          if (portraitResult?.success && portraitResult.absolutePath) {
            projectState.canonicalCharacterImage = portraitResult.absolutePath;
            onAsset?.({ type: 'image', path: portraitResult.absolutePath, segId: 9998, label: '🎭 Nhân vật chính (auto)', filePath: portraitResult.absolutePath });
          }
        } catch (_) {}
      }

      // ── Enforce visual diversity: prevent AI laziness (all text/graphic) ──
      const segs = args.segments || [];
      const LAZY_TYPES = new Set(['text', 'graphic', 'motion_graphic']);
      // First & last scenes are OK as text/graphic (hook + CTA)
      // Middle scenes: max 30% can be lazy types
      const middle = segs.slice(1, segs.length - 1);
      const lazyMid = middle.filter(s => LAZY_TYPES.has(s.visual_type));
      const maxLazy = Math.max(1, Math.floor(middle.length * 0.30));
      let converted = 0;
      if (lazyMid.length > maxLazy) {
        let excess = lazyMid.length - maxLazy;
        let toggle = 0;
        for (const seg of middle) {
          if (excess <= 0) break;
          if (!LAZY_TYPES.has(seg.visual_type)) continue;
          // Alternate between ai_image and broll for variety
          if (toggle % 2 === 0) {
            seg.visual_type = 'ai_image';
            if (!seg.visual_prompt) seg.visual_prompt = seg.narration?.slice(0, 120) || seg.text_heading || 'cinematic visual scene';
          } else {
            seg.visual_type = 'broll';
            if (!seg.broll_query) seg.broll_query = (seg.narration || seg.text_heading || 'relevant scene').split(/[,.!?]/)[0].trim().slice(0, 60);
          }
          toggle++;
          excess--;
          converted++;
        }
      }

      // ── Respect brollMode setting: remap visual types to match user's choice ──
      if (brollMode !== 'auto') {
        for (const seg of segs) {
          if (brollMode === 'image' && (seg.visual_type === 'broll' || seg.visual_type === 'ai_video')) {
            seg.visual_type = 'ai_image';
            if (!seg.visual_prompt) seg.visual_prompt = seg.narration?.slice(0, 120) || 'visual scene';
          } else if (brollMode === 'video' && (seg.visual_type === 'ai_image' || seg.visual_type === 'broll')) {
            seg.visual_type = 'ai_video';
            if (!seg.ai_video_prompt) seg.ai_video_prompt = seg.visual_prompt || seg.broll_query || seg.narration?.slice(0, 100) || 'cinematic scene';
          } else if (brollMode === 'stock' && seg.visual_type === 'ai_video') {
            seg.visual_type = 'broll';
            if (!seg.broll_query) seg.broll_query = seg.narration?.slice(0, 60) || 'relevant footage';
          }
        }
      }

      // ── Auto mode: remap ai_image/ai_video/broll → broll with broll_media flag ──
      // acquire_broll (Imagen/Veo API) instead of generate_image (JSX code)
      let autoRemapped = 0;
      if (brollMode === 'auto') {
        for (const seg of segs) {
          if (seg.visual_type === 'ai_image') {
            seg.visual_type = 'broll';
            if (!seg.broll_media) seg.broll_media = 'image';
            if (!seg.broll_query && seg.visual_prompt) seg.broll_query = seg.visual_prompt.slice(0, 150);
            autoRemapped++;
          } else if (seg.visual_type === 'ai_video') {
            seg.visual_type = 'broll';
            seg.broll_media = 'video';
            if (!seg.broll_query && seg.ai_video_prompt) seg.broll_query = seg.ai_video_prompt.slice(0, 150);
            autoRemapped++;
          } else if (seg.visual_type === 'broll' && !seg.broll_media) {
            // Gemini planned broll trực tiếp → auto mode nên tạo video (stock/AI)
            seg.broll_media = 'video';
            autoRemapped++;
          }
        }
      }

      // ── Humanize all narrations (batch, user-selected model) ──
      try {
        const lang = args.lang || 'vi';
        const humanized = await humanizeNarrations(segs, apiKeys, model, lang);
        humanized.forEach((h, i) => { if (segs[i]) segs[i].narration = h.narration; });
      } catch (_) {}

      const total = segs.length;
      const lazyTotal = segs.filter(s => LAZY_TYPES.has(s.visual_type)).length;
      const visualTotal = total - lazyTotal;
      const autoHint = (brollMode === 'auto' && autoRemapped > 0)
        ? ` AUTO MIX: ${autoRemapped} cảnh → broll. Gọi acquire_broll với broll_media từ must_acquire (image=ảnh Imagen, video=clip Veo). KHÔNG dùng generate_image.`
        : '';
      return {
        success: true,
        message: `Plan stored + narrations humanized. ${total} scenes: ${visualTotal} need visual assets, ${lazyTotal} text/graphic.${converted > 0 ? ` Auto-converted ${converted} lazy scenes to visual types.` : ''}${autoHint} NOW acquire assets for ALL broll/ai_image/ai_video scenes.`,
        segments: total,
        must_acquire: segs.filter(s => ['broll','ai_image','ai_video','illustration'].includes(s.visual_type))
          .map(s => ({ id: s.id, visual_type: s.visual_type, broll_media: s.broll_media || null })),
      };
    }

    case 'acquire_broll': {
      // auto mode: AI chọn per-cảnh qua args.broll_media
      const effectiveMode = brollMode === 'auto'
        ? (args.broll_media || 'image')
        : brollMode;

      // ── Character consistency: build effective reference image list ─────────────
      // Rule: original user photos are ALWAYS used as-is when provided.
      //       canonical (AI-generated) is only used when user provided NO original refs,
      //       to maintain character consistency across scenes when there's no source photo.
      const hasCanonical = !!projectState.canonicalCharacterImage;
      let effectiveRefImages = refImagePaths.length > 0
        ? [...refImagePaths]
        : (hasCanonical ? [projectState.canonicalCharacterImage] : []);

      // Inject character description into prompt for semantic consistency
      const hasCharRef = refImagePaths.length > 0 || hasCanonical;
      let brollQuery = args.query || '';
      if (hasCharRef && projectState.characterDescription) {
        const charDesc = projectState.characterDescription;
        brollQuery = `${brollQuery}, featuring: ${charDesc} — same character, consistent appearance throughout video`;
      } else if (hasCharRef) {
        brollQuery = `${brollQuery} — same character as reference, consistent appearance throughout video`;
      }

      const result = await api.agentAcquireBroll({
        query: brollQuery,
        segmentId: segId,
        durationSec: args.duration_sec || 6,
        mode: effectiveMode,
        veoModel,
        refImagePaths: effectiveRefImages,
      });
      if (result?.success) {
        if (!projectState.assets[segId]) projectState.assets[segId] = {};
        let displayPath = result.file; // sẽ được cập nhật thành absolute path sau khi copy
        if (result.type === 'ai_image') {
          const segStr0 = String(segId).padStart(3, '0');
          const aiExt = (result.file?.split('.').pop() || 'png').toLowerCase();
          const aiDest = `images/broll_img_${segStr0}.${aiExt}`;
          try {
            const cr = await api.remotionCopyAudioToPublic({ srcPath: result.file, destName: aiDest });
            if (cr?.destPath) displayPath = cr.destPath; // absolute path trong Remotion public
          } catch (_) {}
          projectState.assets[segId].imagePath = aiDest; // Remotion-relative, dùng cho render

          // Save first AI-generated image as canonical ONLY when user has no original refs.
          // When user provides ref images, we always use those originals directly — never replace.
          if (refImagePaths.length === 0 && result.absolutePath && !projectState.canonicalCharacterImage) {
            projectState.canonicalCharacterImage = result.absolutePath;
          }
        } else {
          const segStr = String(segId).padStart(3, '0');
          const destName = `broll/seg_${segStr}_broll.mp4`;
          try {
            const cr = await api.remotionCopyAudioToPublic({ srcPath: result.file, destName });
            projectState.assets[segId].brollFile = destName;
            if (cr?.destPath) displayPath = cr.destPath; // absolute path
          } catch (_) {
            projectState.assets[segId].brollFile = result.file;
          }
          projectState.assets[segId].brollDuration = result.duration;
        }
        // Copy thêm vào outputDir để user truy cập trực tiếp
        if (outputDir) {
          const segStr2 = String(segId).padStart(3, '0');
          const assetKind2 = result.type === 'ai_image' ? 'img' : 'broll';
          const ext2 = (result.file.split('.').pop() || (result.type === 'ai_image' ? 'png' : 'mp4')).toLowerCase();
          try { await api.copyFileToOutput?.({ src: result.file, dest: `${outputDir}\\asset_${segStr2}_${assetKind2}.${ext2}` }); } catch (_) {}
        }
        const assetKind = result.type === 'ai_image' ? 'image' : 'video';
        const requestedVideo = ['video', 'broll', 'ai_video'].includes(effectiveMode);
        const gotVideo = result.type !== 'ai_image';
        const fallbackLevel = requestedVideo && !gotVideo ? 1 : 0;
        if (!projectState.assetRegistry) projectState.assetRegistry = {};
        const brollAssetId = `asset_${segId}_broll`;
        projectState.assetRegistry[brollAssetId] = {
          asset_id: brollAssetId, type: assetKind,
          source: result.type === 'ai_image' ? 'imagen' : 'veo',
          requested_type: effectiveMode, actual_type: result.type || assetKind,
          fallback_level: fallbackLevel,
          path: projectState.assets[segId].brollFile || projectState.assets[segId].imagePath || result.file,
          duration: result.duration || null,
          tags: (args.query || '').split(' ').slice(0, 4).filter(Boolean),
          used_count: 1,
        };
        const fallbackNote = fallbackLevel > 0 ? ` (fallback L${fallbackLevel}: requested ${effectiveMode}, got ${result.type})` : '';
        const brollSrc = result.type === 'ai_image' ? 'imagen' : 'veo';
        onAsset?.({ type: assetKind, path: displayPath, filePath: displayPath, segId,
          label: `Scene ${segId}${fallbackNote}`, duration: result.duration || null,
          source: brollSrc, fallback_level: fallbackLevel });
        return { success: true, file: projectState.assets[segId].brollFile || result.file, type: result.type || 'broll', duration: result.duration, fallback_level: fallbackLevel };
      }

      // Fallback: Gemini viết Remotion JSX → renderStill → PNG (không cần Chrome extension)
      const firstKey = apiKeys?.[0];
      if (firstKey) {
        try {
          const illResult = await api.agentRenderIllustration({
            narration: args.query,
            topic: args.query?.slice(0, 120),
            style: 'cinematic dark dramatic',
            segId,
            apiKey: firstKey,
            outputDir,
            refImagePaths,
            format: projectState.plan?.format,
          });
          if (illResult?.success && illResult.file) {
            if (!projectState.assets[segId]) projectState.assets[segId] = {};
            const segStr3 = String(segId).padStart(3, '0');
            const illExt3 = (illResult.file.split('.').pop() || 'png').toLowerCase();
            const illDest3 = `images/fallback_seg_${segStr3}.${illExt3}`;
            try { await api.remotionCopyAudioToPublic({ srcPath: illResult.file, destName: illDest3 }); } catch (_) {}
            projectState.assets[segId].imagePath = illDest3;
            if (!projectState.assetRegistry) projectState.assetRegistry = {};
            projectState.assetRegistry[`asset_${segId}_broll`] = {
              asset_id: `asset_${segId}_broll`, type: 'image', source: 'illustration_fallback',
              requested_type: effectiveMode, actual_type: 'illustration', fallback_level: 2,
              path: illDest3, duration: null, tags: [(args.query||'').slice(0,40)], used_count: 1,
            };
            let illDisplay = illResult.file;
            try { const cr3 = await api.remotionCopyAudioToPublic({ srcPath: illResult.file, destName: illDest3 }); if (cr3?.destPath) illDisplay = cr3.destPath; } catch (_) {}
            onAsset?.({ type: 'image', path: illDisplay, filePath: illDisplay, segId, label: `🎨 Illustration fallback L2 – scene ${segId}`, source: 'illustration_fallback', fallback_level: 2 });
            return { success: true, file: illDest3, type: 'ai_image', fallback_level: 2 };
          }
        } catch (_) {}
      }

      return { success: false, message: result?.error || 'B-roll không khả dụng' };
    }

    case 'generate_tts': {
      const segStr = String(segId).padStart(3, '0');
      let ttsFilePath, ext;

      // Map emotion → speed multiplier if speed not explicitly given
      const emotionSpeedMap = { calm:0.85, excited:1.2, serious:0.9, dramatic:0.8, gentle:0.88, energetic:1.25 };
      const ttsSpeed = args.speed ?? (emotionSpeedMap[args.emotion] ?? 1.0);

      // Retry wrapper: 3 lần, exponential backoff + random jitter để tránh thundering herd
      const withTtsRetry = async (fn, maxRetries = 3) => {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try { return await fn(); }
          catch (err) {
            if (attempt === maxRetries - 1) throw err;
            const delay = 600 * (attempt + 1) + Math.floor(Math.random() * 800);
            await new Promise(r => setTimeout(r, delay));
          }
        }
      };

      if (ttsProvider === 'gemini') {
        const ttsResult = await withTtsRetry(() => api.geminiTTS({
          text: args.text,
          voiceName: voice,
          apiKeys,
          outputFolder: outputDir,
          projectName: `agent_seg_${segStr}`,
          speakingRate: ttsSpeed,
        }));
        if (!ttsResult?.success) throw new Error(ttsResult?.error || 'Gemini TTS failed');
        ttsFilePath = ttsResult.path;
        ext = 'wav';
      } else if (ttsProvider === 'kokoro') {
        ext = 'wav';
        const tempPath = `${outputDir}\\agent_tts_${segStr}_${Date.now()}.${ext}`;
        const ttsResult = await withTtsRetry(async () => {
          const r = await api.kokoroSynthesize({ text: args.text, voice, speed: ttsSpeed, outputPath: tempPath });
          if (!r?.success) throw new Error(r?.error || 'Kokoro TTS failed');
          return r;
        });
        ttsFilePath = ttsResult.path || tempPath;
      } else if (ttsProvider === 'vieneu') {
        ext = 'wav';
        const tempPath = `${outputDir}\\agent_tts_${segStr}_${Date.now()}.${ext}`;
        const isClone = voice?.startsWith('clone:');
        const cloneProfile = isClone
          ? vieNeuSavedVoices.find(v => String(v.id) === voice.replace('clone:', ''))
          : null;
        // VieNeu Python chỉ nhận tên ngắn (vd: "Thái Sơn"), không nhận chuỗi đầy đủ
        const shortVoiceId = isClone ? undefined : (voice ? voice.split(/\s*[—–\-]\s*/)[0].trim() : undefined);
        const ttsResult = await withTtsRetry(() => api.vieNeuSynthesize({
          text: args.text,
          outputPath: tempPath,
          voiceId:  shortVoiceId,
          refAudio: cloneProfile?.refAudio || undefined,
          refText:  cloneProfile?.refText  || undefined,
        }));
        if (!ttsResult?.success) throw new Error(ttsResult?.error || 'VieNeu TTS failed');
        ttsFilePath = ttsResult.path || tempPath;
      } else {
        // Edge TTS (default, free) — rate limited, retry với jitter
        ext = 'mp3';
        const tempPath = `${outputDir}\\agent_tts_${segStr}_${Date.now()}.${ext}`;
        const ttsResult = await withTtsRetry(() => api.generateVoice({
          text: args.text,
          voice: voice,
          outputPath: tempPath,
        }));
        if (!ttsResult?.success) throw new Error(ttsResult?.error || 'Edge TTS failed');
        ttsFilePath = ttsResult.path || tempPath;
      }

      const destName = `audio/agent_seg_${segStr}.${ext}`;
      await api.remotionCopyAudioToPublic({ srcPath: ttsFilePath, destName });

      const duration = await api.remixerGetAudioDuration({ audioPath: ttsFilePath });
      if (!projectState.assets[segId]) projectState.assets[segId] = {};
      projectState.assets[segId].ttsFile = destName;
      projectState.assets[segId].ttsDuration = duration || args.duration_sec || 5;
      if (!projectState.assetRegistry) projectState.assetRegistry = {};
      projectState.assetRegistry[`asset_${segId}_tts`] = {
        asset_id: `asset_${segId}_tts`, type: 'audio', source: ttsProvider,
        path: destName, duration: projectState.assets[segId].ttsDuration,
        tags: [args.emotion || 'calm'], used_count: 1,
      };

      onAsset?.({ type: 'voice', path: ttsFilePath, segId, duration: projectState.assets[segId].ttsDuration, text: args.text?.slice(0, 100) });
      return { success: true, file: destName, duration: projectState.assets[segId].ttsDuration };
    }

    case 'generate_image': {
      const errors = [];
      const segStr = String(segId).padStart(3, '0');
      if (!projectState.assets[segId]) projectState.assets[segId] = {};
      const imgPrompt = (args.prompt || args.topic || '') + (args.style ? `, ${args.style} style` : '');

      const _saveImage = async (srcPath, destName, source, fallbackLevel) => {
        let displayPath = srcPath;
        try {
          const cr = await api.remotionCopyAudioToPublic({ srcPath, destName });
          if (cr?.destPath) displayPath = cr.destPath; // absolute path sau khi copy
        } catch (_) {}
        // Copy thêm vào outputDir để user truy cập trực tiếp
        if (outputDir) {
          const fn = destName.replace(/\//g, '_').replace(/\\/g, '_');
          try {
            const cr2 = await api.copyFileToOutput?.({ src: srcPath, dest: `${outputDir}\\${fn}` });
            // Không dùng cr2.destPath làm displayPath — Remotion vẫn cần path trong public dir
          } catch (_) {}
        }
        projectState.assets[segId].imagePath = destName; // Remotion-relative, dùng cho render
        if (!projectState.assetRegistry) projectState.assetRegistry = {};
        projectState.assetRegistry[`asset_${segId}_image`] = {
          asset_id: `asset_${segId}_image`, type: 'image', source,
          path: destName, duration: null, fallback_level: fallbackLevel,
          tags: [(args.topic || args.prompt || '').slice(0, 40)], used_count: 1,
        };
        // filePath dùng displayPath (absolute) để fileUrl() tạo đúng URL preview
        onAsset?.({ type: 'image', path: displayPath, filePath: displayPath, segId,
          label: `🖼️ AI Image ${segId}`, source, fallback_level: fallbackLevel });
      };

      // ── PRIMARY: VeoEngine Imagen (real AI image via Google Labs)
      try {
        const imgResult = await api.agentAcquireBroll({
          query: imgPrompt, segmentId: segId, durationSec: 5, mode: 'image', veoModel: 'Veo 3.1 - Lite [Lower Priority]', refImagePaths,
        });
        if (imgResult?.success && imgResult.file) {
          const ext  = (imgResult.file.split('.').pop() || 'png').toLowerCase();
          const dest = `images/veo_img_${segStr}.${ext}`;
          await _saveImage(imgResult.file, dest, 'veoengine_imagen', 0);
          return { success: true, file: dest, source: 'ai_image', fallback_level: 0 };
        }
        errors.push(`VeoEngine: ${imgResult?.error || imgResult?.message || 'no file'}`);
      } catch (e) { errors.push(`VeoEngine: ${e.message?.slice(0, 80)}`); }

      // ── FALLBACK 1: Imagen 4 via Chrome extension background window
      try {
        const imgResult = await api.bgGenerateImage?.({
          prompt: imgPrompt, model: 'Imagen 4', outputFolder: outputDir, taskId: `agent_img_${segId}`,
        });
        const imgPath = imgResult?.imagePath || imgResult?.path;
        if (imgPath) {
          const dest = `images/agent_seg_${segStr}.jpg`;
          await _saveImage(imgPath, dest, 'imagen4_bg', 1);
          return { success: true, file: dest, source: 'ai_image', fallback_level: 1 };
        }
        errors.push(`Imagen4: ${imgResult?.error || 'no file'}`);
      } catch (e) { errors.push(`Imagen4: ${e.message?.slice(0, 80)}`); }

      // ── LAST RESORT: Remotion illustration — rich JSON-driven graphic (NOT an AI image)
      // Dùng khi không có real AI image provider. Output là styled graphic, fallback_level=2.
      const tryKeys = apiKeys?.length ? apiKeys : [];
      for (let ki = 0; ki < tryKeys.length; ki++) {
        try {
          const r = await api.agentRenderIllustration({
            narration: args.narration || args.prompt,
            topic:     args.topic    || args.prompt?.slice(0, 120),
            style:     args.style    || 'modern dark cinematic',
            segId, apiKey: tryKeys[ki], outputDir, refImagePaths,
            format: projectState.plan?.format,
          });
          if (r?.success && r.file) {
            const illExt  = (r.file.split('.').pop() || 'png').toLowerCase();
            const illDest = `images/illustration_seg_${segStr}.${illExt}`;
            await _saveImage(r.file, illDest, 'remotion_illustration', 2);
            // Include veo errors so user knows illustration is fallback
            const veoErrors = errors.filter(e => e.startsWith('VeoEngine')).join('; ');
            return { success: true, file: illDest, source: 'illustration', fallback_level: 2,
              warning: veoErrors ? `Veo/Imagen không khả dụng: ${veoErrors.slice(0, 120)}. Dùng illustration fallback.` : 'Dùng illustration fallback' };
          }
          errors.push(`Illustration[k${ki+1}]: ${r?.error || 'no file'}`);
          if (!String(r?.error).includes('quota') && !String(r?.error).includes('429')) break;
        } catch (e) {
          const msg = e.message || String(e);
          errors.push(`Illustration[k${ki+1}]: ${msg.slice(0, 120)}`);
          if (!msg.includes('quota') && !msg.includes('429') && !msg.includes('RESOURCE_EXHAUSTED')) break;
        }
      }

      return { success: false, message: errors.join(' | ') };
    }

    case 'search_stock_footage': {
      try {
        // brollMode='video': bypass stock search entirely, use AI video generation
        if (brollMode === 'video') {
          return await executeTool('acquire_broll', { segment_id: segId, query: args.query, duration_sec: args.duration_sec || 6, broll_media: 'video' }, { apiKeys, voice, ttsProvider, brollMode, veoModel, outputDir, vieNeuSavedVoices, projectState, refImagePaths, onAsset, manualSfxList });
        }

        const pexelsKey  = await api.getSetting('pexels_api_key',  '');
        const pixabayKey = await api.getSetting('pixabay_api_key', '');
        const provider = args.provider || 'both';

        if (!pexelsKey && !pixabayKey) {
          // Fallback to acquire_broll if no stock keys
          return await executeTool('acquire_broll', { segment_id: segId, query: args.query, duration_sec: args.duration_sec || 6 }, { apiKeys, voice, ttsProvider, brollMode, veoModel, outputDir, vieNeuSavedVoices, projectState, refImagePaths, onAsset, manualSfxList });
        }

        const apiKey = provider === 'pexels' ? pexelsKey : provider === 'pixabay' ? pixabayKey : { pexels: pexelsKey, pixabay: pixabayKey };
        const searchRes = await api.stockVideoSearch({ keyword: args.query, provider: (!pexelsKey ? 'pixabay' : !pixabayKey ? 'pexels' : provider), apiKey, perPage: 3 });

        if (!searchRes?.success || !searchRes.results?.length) {
          return await executeTool('acquire_broll', { segment_id: segId, query: args.query, duration_sec: args.duration_sec || 6 }, { apiKeys, voice, ttsProvider, brollMode, veoModel, outputDir, vieNeuSavedVoices, projectState, refImagePaths, onAsset, manualSfxList });
        }

        // getRemotionPublicDir() trả về string path (không phải object)
        const publicDir = await api.getRemotionPublicDir?.();
        const segStr = String(segId).padStart(3, '0');
        const destName = `broll/seg_${segStr}_stock.mp4`;
        // Download vào temp rồi copy vào public qua IPC
        const tempPath = `${outputDir || publicDir}\\broll_stock_${segStr}_tmp.mp4`;

        const clip = searchRes.results[0];
        const dlRes = await api.stockVideoDownload({ url: clip.url, destPath: tempPath });

        if (dlRes?.success) {
          let stockDisplayPath = tempPath;
          try {
            const cr = await api.remotionCopyAudioToPublic({ srcPath: tempPath, destName });
            if (cr?.destPath) stockDisplayPath = cr.destPath;
          } catch (_) {}
          if (!projectState.assets[segId]) projectState.assets[segId] = {};
          projectState.assets[segId].brollFile = destName;
          projectState.assets[segId].brollDuration = clip.duration;
          onAsset?.({ type: 'video', path: stockDisplayPath, filePath: stockDisplayPath, segId, label: `Stock: ${args.query}`, duration: clip.duration, source: 'pexels' });
          return { success: true, file: destName, type: 'stock', duration: clip.duration, provider: clip.provider };
        }
      } catch (_) {}
      // Fallback
      return await executeTool('acquire_broll', { segment_id: segId, query: args.query, duration_sec: args.duration_sec || 6 }, { apiKeys, voice, ttsProvider, brollMode, veoModel, outputDir, vieNeuSavedVoices, projectState, refImagePaths, onAsset });
    }

    case 'add_background_music': {
      if (!projectState.plan) projectState.plan = {};
      const bgVol = Math.min(0.3, Math.max(0.03, args.volume || 0.12));
      projectState.plan.bgMusic = {
        mood: args.mood || 'cinematic',
        volume: bgVol,
        genre: args.genre || '',
      };
      // Try to resolve actual music file immediately so QA can verify it
      try {
        const musicPath = await api.agentFindMusic?.(args.mood || 'cinematic');
        if (musicPath) {
          projectState.plan.bgMusic.musicFile = musicPath;
          let musicDisplay = musicPath;
          try {
            const mfn = `music_${(args.mood||'cinematic').replace(/[^a-z0-9]/gi,'_')}.mp3`;
            const cr = await api.remotionCopyAudioToPublic({ srcPath: musicPath, destName: `audio/${mfn}` });
            if (cr?.destPath) musicDisplay = cr.destPath;
          } catch (_) {}
          onAsset?.({ type: 'music', path: musicDisplay, segId: 0, label: `🎵 Music: ${args.mood}` });
          return { success: true, message: `🎵 Nhạc nền "${args.mood}" (vol ${bgVol}) — file: ${musicPath.split(/[\\/]/).pop()}` };
        }
      } catch (_) {}
      return { success: true, message: `🎵 Nhạc nền "${args.mood || 'cinematic'}" (vol ${bgVol}) lên lịch — sẽ tìm file khi render` };
    }

    case 'set_platform_config': {
      if (!projectState.plan) projectState.plan = {};
      projectState.plan.platform = args;
      return { success: true, message: `Platform config: ${args.platform} | hook: ${args.hook_strategy || 'auto'} | pacing: ${args.pacing || 'medium'}` };
    }

    case 'render_video': {
      // Pre-render check: cảnh nào cần visual mà chưa có → block render, yêu cầu generate trước
      if (projectState.plan?.segments?.length > 0) {
        const needsVisual = ['ai_image', 'ai_video', 'broll'];
        const missing = projectState.plan.segments.filter(seg => {
          if (!needsVisual.includes(seg.visual_type)) return false;
          const asset = projectState.assets?.[seg.id];
          // imagePath = generate_image, brollFile = acquire_broll/broll
          return !asset?.imagePath && !asset?.brollFile;
        });
        if (missing.length > 0 && (projectState.fixCount || 0) < 3) {
          const list = missing.map(s => `• scene ${s.id} (${s.visual_type})`).join('\n');
          return {
            success: false,
            error: 'visual_missing',
            missing_scenes: missing.map(s => s.id),
            instruction: `🚫 KHÔNG được render khi còn cảnh chưa có visual!\n${list}\nHãy gọi generate_image / acquire_broll cho các cảnh trên TRƯỚC, rồi mới gọi render_video.`,
          };
        }
      }

      // Merge manual SFX từ UI vào plan
      if (manualSfxList?.length > 0) {
        if (!projectState.plan) projectState.plan = {};
        if (!projectState.plan.sfxList) projectState.plan.sfxList = [];
        const existingIds = new Set(projectState.plan.sfxList.map(s => `${s.id}_${s.at_sec ?? s.at}`));
        for (const ms of manualSfxList) {
          const key = `${ms.id}_${ms.at_sec}`;
          if (!existingIds.has(key)) projectState.plan.sfxList.push(ms);
        }
      }

      const editPlan = buildEditPlan(projectState.plan, projectState.assets);
      await api.remixerWritePlan({ plan: editPlan });

      const filename = args.output_filename || `agent_video_${Date.now()}.mp4`;
      const sep = outputDir.includes('\\') ? '\\' : '/';
      const outPath = `${outputDir}${sep}${filename}`;

      const result = await api.remixerRender({ outputPath: outPath });
      if (!result?.success) throw new Error(result?.error || 'Render failed');

      projectState.outputPath = result.outputPath || outPath;

      // Mix background music với auto-ducking khi voice được phát hiện
      if (projectState.plan?.bgMusic && projectState.outputPath) {
        try {
          const bgm = projectState.plan.bgMusic;
          const musicPath = await api.agentFindMusic?.(bgm.mood);
          onAsset?.({ type: 'info', segId: 0, path: '', label: musicPath ? `🎵 Nhạc nền: ${bgm.mood}` : `🔇 Không tìm được nhạc "${bgm.mood}" — thêm MP3 vào assets/music/ hoặc nhạc sẽ được tải từ Jamendo` });
          if (musicPath) {
            const mixedPath = projectState.outputPath.replace('.mp4', '_music.mp4');
            // Ưu tiên dùng ducking (giảm nhạc khi có giọng nói)
            const duckRes = await api.mixAudioDucking?.({
              videoPath: projectState.outputPath,
              musicPath,
              outputPath: mixedPath,
              options: { musicVol: bgm.volume || 0.15, threshold: 0.02, ratio: 8 },
            });
            if (duckRes?.success) {
              projectState.outputPath = mixedPath;
              projectState.plan.bgMusic.mixedFile = mixedPath;
              projectState.plan.bgMusic.musicFile = musicPath;
            } else {
              const mixRes = await api.mixAudio?.({
                videoPath: projectState.outputPath,
                audioPath: musicPath,
                outputPath: mixedPath,
                videoVol: 1.0,
                audioVol: bgm.volume || 0.12,
              });
              if (mixRes?.success) {
                projectState.outputPath = mixedPath;
                projectState.plan.bgMusic.mixedFile = mixedPath;
                projectState.plan.bgMusic.musicFile = musicPath;
              }
            }
          }
        } catch (_) {}
      }

      // Mix SFX vào video sau BGM
      const sfxItems = (projectState.plan?.sfxList || []).filter(s => s.id || s.sfx_id);
      if (sfxItems.length > 0 && projectState.outputPath) {
        try {
          const sfxMixedPath = projectState.outputPath.replace('.mp4', '_sfx.mp4');
          const sfxRes = await api.mixSfxList?.({
            videoPath: projectState.outputPath,
            sfxList: sfxItems,
            outputPath: sfxMixedPath,
          });
          if (sfxRes?.success) projectState.outputPath = sfxMixedPath;
        } catch (_) {}
      }

      onAsset?.({ type: 'final_video', path: projectState.outputPath, segId: 0, label: 'Video hoàn chỉnh' });

      // Auto QA sau mỗi render — trả required_fixes để AI biết cần fix gì
      const qaCtx = { apiKeys, model, voice, ttsProvider, brollMode, veoModel, outputDir, vieNeuSavedVoices, projectState, refImagePaths, onAsset, manualSfxList };
      const qaResult = await executeTool('quality_check', { auto_fix: true }, qaCtx);
      const fixCount = projectState.fixCount || 0;

      if (qaResult.patch?.length > 0 && fixCount < 2) {
        projectState.fixCount = fixCount + 1;
        return {
          success: true,
          output_path: projectState.outputPath,
          qa: qaResult,
          required_fixes: qaResult.patch,
          instruction: `⚠️ QA phát hiện ${qaResult.patch.length} vấn đề (vòng ${fixCount + 1}/2). Hãy fix TỪNG scene theo action rồi gọi render_video lại:\n${qaResult.patch.map(p => `• scene ${p.scene_id}: ${p.action}`).join('\n')}`,
        };
      }

      return {
        success: true,
        output_path: projectState.outputPath,
        qa: { score: qaResult.score, passed: qaResult.passed, issues_count: qaResult.issues?.length || 0 },
      };
    }

    case 'research_topic': {
      if (!apiKeys?.length) return { success: false, error: 'No API key' };

      const depthGuide = args.depth === 'deep'
        ? 'Cung cấp 8–10 facts/số liệu cụ thể, có nguồn dẫn chứng. Bao gồm: thống kê %, số tiền, năm nghiên cứu, tên tổ chức.'
        : 'Cung cấp 4–5 điểm chính quan trọng nhất, mỗi điểm 1 câu ngắn.';

      const focusGuide = args.focus ? `\nTập trung đặc biệt vào: ${args.focus}` : '';
      const lang = args.lang || 'vi';

      const researchPrompt = `Nghiên cứu chuyên sâu về chủ đề: "${args.topic}"
${depthGuide}${focusGuide}

Trả về kết quả dạng JSON với cấu trúc:
{
  "summary": "Tóm tắt 2–3 câu về chủ đề",
  "key_facts": [
    { "fact": "Nội dung fact cụ thể", "source": "Nguồn/nghiên cứu nếu có", "usable_as": "graphic|narration|hook|cta" }
  ],
  "statistics": [
    { "label": "Tên chỉ số", "value": "Giá trị cụ thể", "context": "Giải thích ngắn" }
  ],
  "hook_ideas": ["Ý tưởng hook 1", "Ý tưởng hook 2"],
  "key_insight": "Insight sâu sắc nhất có thể trở thành thông điệp chính của video"
}

Ngôn ngữ: ${lang === 'vi' ? 'Tiếng Việt' : 'English'}. Chỉ trả về JSON, không giải thích thêm.`;

      try {
        const res = await geminiGenerateWithRotation(apiKeys, model, {
          contents: [{ role: 'user', parts: [{ text: researchPrompt }] }],
          config: { temperature: 0.3, maxOutputTokens: 1200 },
        });
        const raw = res.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        const data = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
        projectState.research = data;
        return { success: true, data, message: `Đã nghiên cứu "${args.topic}": ${data.key_facts?.length || 0} facts, ${data.statistics?.length || 0} số liệu` };
      } catch (err) {
        // Không để research fail chặn toàn bộ pipeline — trả success với data rỗng
        projectState.research = { summary: args.topic, key_facts: [], statistics: [], hook_ideas: [], key_insight: '' };
        return { success: true, data: projectState.research, message: `Research skipped (${err.message?.slice(0,60)}), continuing with AI knowledge.` };
      }
    }

    case 'add_sfx': {
      if (!projectState.plan) projectState.plan = {};
      if (!projectState.plan.sfxList) projectState.plan.sfxList = [];
      const sfxEntry = {
        id:          args.sfx_id,
        at:          args.at_sec,
        volume:      args.volume ?? 0.7,
        duration_sec:args.duration_sec,
        description: args.description || '',
      };
      projectState.plan.sfxList.push(sfxEntry);
      const sfxAssetId = `sfx_${args.sfx_id}_${String(args.at_sec).replace('.', '_')}`;
      onAsset?.({
        type: 'sfx',
        id: sfxAssetId,
        segId: sfxAssetId, // unique string segId tránh dedup nhầm với sfx khác
        label: `🔊 ${args.sfx_id} @ ${args.at_sec}s`,
        path: args.sfx_id,
        at_sec: args.at_sec,
        volume: sfxEntry.volume,
        description: args.description || '',
      });
      return { success: true, message: `SFX "${args.sfx_id}" lên lịch tại ${args.at_sec}s` };
    }

    case 'quality_check': {
      const plan = projectState.plan;
      const assets = projectState.assets || {};
      const registry = projectState.assetRegistry || {};
      const segments = plan?.segments || [];
      const issues = [];
      const patch = [];

      // ── 1. TECHNICAL: per-scene asset coverage ──────────────
      let missingTts = 0, missingVisual = 0, fallbackCount = 0;
      const visualTypes = segments.map(s => s.visual_type);
      const needsVisual = ['broll','ai_video','ai_image','illustration'];

      segments.forEach((seg, idx) => {
        const asset = assets[seg.id] || {};
        const hasVisual = !!(asset.brollFile || asset.imagePath);
        const hasTts = !!(asset.ttsFile);
        const needsVis = needsVisual.includes(seg.visual_type);

        if (seg.narration && !hasTts) {
          issues.push({ scene_id: seg.id, severity: 'high', type: 'missing_tts', message: `Scene ${seg.id}: TTS missing` });
          patch.push({ scene_id: seg.id, action: 'regenerate_tts' });
          missingTts++;
        }
        if (needsVis && !hasVisual) {
          issues.push({ scene_id: seg.id, severity: 'high', type: 'missing_visual', message: `Scene ${seg.id}: visual (${seg.visual_type}) missing` });
          patch.push({ scene_id: seg.id, action: 'replace_with_ai_image' });
          missingVisual++;
        }
        // Fallback detection: check both broll and image registry entries
        const regEntry = Object.values(registry).find(r =>
          r.asset_id?.includes(`_${seg.id}_broll`) ||
          r.asset_id?.includes(`_${seg.id}_image`) ||
          r.asset_id?.includes(`seg_${seg.id}`)
        );
        const illustrationFallback = regEntry?.source === 'remotion_illustration' || regEntry?.source === 'illustration_fallback';
        if (illustrationFallback || (regEntry?.fallback_level > 0) || (seg.visual_type === 'broll' && asset.imagePath && !asset.brollFile)) {
          const lvl = regEntry?.fallback_level ?? (illustrationFallback ? 2 : 1);
          const gotType = lvl >= 2 ? 'CSS illustration (not AI image)' : 'AI image instead of video';
          issues.push({ scene_id: seg.id, severity: lvl >= 2 ? 'high' : 'medium', type: 'visual_fallback', message: `Scene ${seg.id}: ${gotType} (fallback L${lvl})` });
          if (lvl >= 2 && !patch.some(p => p.scene_id === seg.id)) {
            patch.push({ scene_id: seg.id, action: 'generate_image', reason: `illustration fallback — retry when VeoEngine/Imagen4 is available` });
          }
          fallbackCount++;
        }
        // Repeated visual type 3+ in a row
        if (idx >= 2 && visualTypes[idx] === visualTypes[idx-1] && visualTypes[idx] === visualTypes[idx-2]) {
          if (!['graphic','text'].includes(visualTypes[idx])) {
            issues.push({ scene_id: seg.id, severity: 'medium', type: 'repeated_visual', message: `3+ consecutive ${seg.visual_type} at scene ${seg.id}` });
          }
        }
      });

      // ── 2. CONTENT: visual diversity score ──────────────────
      const typeCounts = {};
      visualTypes.forEach(t => { typeCounts[t] = (typeCounts[t] || 0) + 1; });
      const nSeg = segments.length || 1;
      const textOnlyPct = ((typeCounts.text || 0) + (typeCounts.graphic || 0)) / nSeg;
      const brollPct = ((typeCounts.broll || 0) + (typeCounts.ai_video || 0)) / nSeg;
      const distinctTypes = Object.keys(typeCounts).length;
      const diversityScore = Math.min(10, distinctTypes * 1.5 + (1 - textOnlyPct) * 4 + brollPct * 3);

      if (textOnlyPct > 0.6) {
        issues.push({ severity: 'high', type: 'low_visual_diversity', message: `${Math.round(textOnlyPct*100)}% scenes are text/graphic — video will feel like a slideshow` });
        patch.push({ action: 'add_more_broll_and_ai_image' });
      }
      if (brollPct < 0.2 && nSeg >= 5) {
        issues.push({ severity: 'medium', type: 'low_broll_coverage', message: `Only ${Math.round(brollPct*100)}% B-roll/AI-video — target ≥20%` });
      }

      // ── 3. AUDIO: music & SFX presence ──────────────────────
      const hasMusicAsset = !!(plan?.bgMusic?.musicFile || plan?.bgMusic?.mixedFile);
      const hasMusicMeta = !!(plan?.bgMusic);
      const sfxList = plan?.sfxList || [];
      const sfxWithTimestamps = sfxList.filter(s => s.at !== undefined || s.at_sec !== undefined);
      const totalDurSec = segments.reduce((s, x) => s + (x.duration_sec || 5), 0);
      const sfxCoverage = sfxWithTimestamps.length > 0 ? sfxWithTimestamps.length / Math.max(1, Math.ceil(totalDurSec / 15)) : 0;

      if (!hasMusicMeta) {
        issues.push({ severity: 'high', type: 'no_music', message: 'No background music — video will feel empty' });
        patch.push({ action: 'add_background_music' });
      } else if (!hasMusicAsset) {
        issues.push({ severity: 'medium', type: 'music_not_mixed', message: `Music planned (${plan.bgMusic.mood}) but no file found in assets/music/` });
      }
      if (sfxList.length === 0 && nSeg >= 3) {
        issues.push({ severity: 'medium', type: 'no_sfx', message: 'No SFX — missing impact, transitions, and emotional beats' });
      } else if (sfxCoverage < 0.5 && nSeg >= 5) {
        issues.push({ severity: 'low', type: 'low_sfx_coverage', message: `Only ${sfxWithTimestamps.length} SFX for ${Math.round(totalDurSec)}s video — add more beats` });
      }

      // ── 4. EXPERIENCE: hook, pacing, transitions ────────────
      const firstSeg = segments[0];
      const lastSeg = segments[segments.length - 1];
      if (firstSeg && !['text','graphic','motion_graphic'].includes(firstSeg.visual_type)) {
        issues.push({ scene_id: firstSeg.id, severity: 'low', type: 'weak_hook', message: 'First scene is not a text/graphic hook — hook should grab attention immediately' });
      }
      if (lastSeg && !['text','graphic'].includes(lastSeg.visual_type)) {
        issues.push({ scene_id: lastSeg.id, severity: 'low', type: 'no_cta', message: 'Last scene is not a CTA/text — add clear call-to-action' });
      }
      const transitions = segments.map(s => s.transition_type || 'cut');
      if (segments.length > 5 && transitions.every(t => t === 'cut')) {
        issues.push({ severity: 'low', type: 'monotone_transitions', message: 'All cuts — add fade/slide/zoom for visual rhythm' });
      }

      // ── 5. VISUAL COVERAGE: duration-weighted (actual asset presence) ──
      let realVisualDur = 0, textOnlyDur = 0;
      segments.forEach(seg => {
        const asset = assets[seg.id] || {};
        const dur = asset.ttsDuration || seg.duration_sec || 5;
        const hasRealAsset = !!(asset.brollFile || asset.imagePath);
        const isTextOnly = !hasRealAsset && ['text', 'graphic', 'chart', 'motion_graphic'].includes(seg.visual_type);
        if (isTextOnly) textOnlyDur += dur;
        else realVisualDur += dur;
      });
      const totalDurQa = realVisualDur + textOnlyDur || 1;
      const visualCoverage = realVisualDur / totalDurQa;

      let hardFail = false;
      if (visualCoverage < 0.5) {
        hardFail = true;
        issues.push({
          severity: 'critical',
          type: 'visual_coverage_fail',
          message: `HARD FAIL: Visual coverage ${Math.round(visualCoverage * 100)}% — ${Math.round(textOnlyDur)}s of ${Math.round(totalDurQa)}s is text-only. Must be ≥50%. Generated images/videos not attached to timeline.`,
        });
        // Patch: all text-only scenes with assets need re-render, others need visual asset
        segments.forEach(seg => {
          const asset = assets[seg.id] || {};
          const hasRealAsset = !!(asset.brollFile || asset.imagePath);
          if (!hasRealAsset && ['text','graphic','chart','motion_graphic'].includes(seg.visual_type)) {
            if (!patch.some(p => p.scene_id === seg.id)) {
              patch.push({ scene_id: seg.id, action: 'generate_image', reason: 'text-only scene missing visual asset' });
            }
          }
        });
      }

      // Unattached assets: images generated but scene still renders as text
      const unattachedCount = segments.filter(seg => {
        const asset = assets[seg.id] || {};
        return (asset.imagePath || asset.brollFile) && ['text','graphic'].includes(seg.visual_type);
      }).length;
      if (unattachedCount > 0) {
        issues.push({ severity: 'critical', type: 'unattached_assets', message: `${unattachedCount} generated visual assets exist but scene visual_type is still 'text'/'graphic' — assets not reaching timeline` });
        hardFail = true;
      }

      // ── 6. COMPOSITE SCORE ───────────────────────────────────
      const techScore = 10 - (missingTts * 2) - (missingVisual * 1.5) - (fallbackCount * 0.5);
      const audioScore = hasMusicMeta ? (hasMusicAsset ? 9 : 6) : 2;
      const sfxScore = sfxList.length === 0 ? 2 : Math.min(9, sfxCoverage * 10);
      const coverageScore = Math.min(10, visualCoverage * 12);
      const finalScore = Math.max(0, Math.min(10,
        techScore * 0.30 + diversityScore * 0.20 + coverageScore * 0.25 + audioScore * 0.15 + sfxScore * 0.10
      ));
      const passed = !hardFail && finalScore >= 6.5;
      projectState.qaResult = { score: finalScore, issues, patch, passed, visualCoverage, breakdown: { techScore, diversityScore, coverageScore, audioScore, sfxScore } };

      const scoreBreakdown = [
        `Tech: ${techScore.toFixed(1)}`,
        `Coverage: ${Math.round(visualCoverage*100)}%`,
        `Diversity: ${diversityScore.toFixed(1)}`,
        `Music: ${audioScore}`,
        `SFX: ${sfxScore.toFixed(1)}`,
      ].join(' · ');
      const hardFailMsg = hardFail ? ' ❌ HARD FAIL' : '';
      const summary = issues.length > 0
        ? `Score ${finalScore.toFixed(1)}/10 [${scoreBreakdown}]${hardFailMsg} | ${issues.filter(i=>['critical','high'].includes(i.severity)).map(i=>i.message).slice(0,3).join('; ')}`
        : `Score ${finalScore.toFixed(1)}/10 — video quality good [${scoreBreakdown}]`;

      return {
        success: true, status: passed ? 'pass' : 'fail',
        score: finalScore, passed, hardFail, issues, patch, summary,
        visual_coverage: { total_duration: Math.round(totalDurQa), visual_duration: Math.round(realVisualDur), text_duration: Math.round(textOnlyDur), coverage: Math.round(visualCoverage * 100) / 100 },
        breakdown: { techScore, diversityScore, coverageScore, audioScore, sfxScore, brollPct, textOnlyPct, visualCoverage, sfxCount: sfxList.length },
        recommendation: passed
          ? 'Video ready — good quality across technical, diversity, and audio'
          : hardFail
          ? `❌ HARD FAIL — cannot export. Required fixes: ${patch.slice(0,5).map(p=>`scene ${p.scene_id}: ${p.action}`).join(', ')}`
          : `Fix recommended: ${issues.filter(i=>i.severity==='high').map(i=>i.message).join('; ')}`,
      };
    }

    case 'generate_seo': {
      if (!apiKeys?.length) return { success: false, error: 'No API key' };
      const platform = args.platform || 'youtube';
      const lang = args.lang || 'vi';
      const plan = projectState.plan || {};
      const segments = plan.segments || [];
      const videoTitle = plan.title || '';
      // Dùng ttsDuration thực tế (từ audio đã render) thay vì duration_sec ước tính
      const segDurations = segments.map(s => {
        const asset = (projectState.assets || {})[s.id] || {};
        return asset.ttsDuration ? (asset.ttsDuration + 0.5) : (s.duration_sec || 5);
      });
      const totalSec = segDurations.reduce((a, d) => a + d, 0);

      // Build timestamps chính xác từ duration thực tế
      let tsCursor = 0;
      const timestampLines = segments.map((s, i) => {
        const mm = String(Math.floor(tsCursor / 60)).padStart(2, '0');
        const ss = String(Math.floor(tsCursor % 60)).padStart(2, '0');
        const label = (typeof s.narration === 'string' ? s.narration : (s.narration?.text || '')).slice(0, 50) || `Cảnh ${i + 1}`;
        tsCursor += segDurations[i];
        return `${mm}:${ss} ${label}`;
      }).join('\n');

      const narrations = segments.map((s, i) => `[Cảnh ${i + 1}] ${(typeof s.narration === 'string' ? s.narration : (s.narration?.text || ''))}`).join('\n');
      const langLabel = lang === 'vi' ? 'Tiếng Việt' : 'English';

      const seoSystemPrompt = `Bạn là chuyên gia SEO ${platform === 'youtube' ? 'YouTube' : platform}. Tạo metadata tối ưu hóa để video đạt lượt xem cao nhất.
Chỉ trả về JSON hợp lệ, không giải thích. Ngôn ngữ nội dung: ${langLabel}.`;

      const seoUserPrompt = `Video: "${videoTitle}" — ${Math.round(totalSec)}s (${Math.floor(totalSec/60)}:${String(Math.round(totalSec%60)).padStart(2,'0')})
Platform: ${platform}
Nội dung chính:\n${narrations.slice(0, 1200)}

Timestamps thực tế (dùng nguyên, chỉ cải thiện label nếu cần):
${timestampLines}

Trả về JSON:
{
  "title": "Tiêu đề YouTube tối ưu (max 100 chars, gây tò mò, có keyword, ${langLabel})",
  "description": "Mô tả YouTube đầy đủ (300-500 chars, paragraph tự nhiên, có keyword, có CTA, ${langLabel})",
  "tags": ["tag1", "tag2", "..."],
  "hashtags": "#hashtag1 #hashtag2 #hashtag3 (max 10 hashtags ${langLabel})",
  "timestamps": "timestamps đã cải thiện label, giữ nguyên thời gian MM:SS"
}`;

      try {
        const res = await geminiGenerateWithRotation(apiKeys, model, {
          contents: [{ role: 'user', parts: [{ text: seoUserPrompt }] }],
          config: { systemInstruction: seoSystemPrompt, temperature: 0.4, maxOutputTokens: 800 },
        });
        const raw = res.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        const seoData = jsonMatch ? JSON.parse(jsonMatch[0]) : { title: videoTitle, description: '', tags: [], hashtags: '', timestamps: '' };
        projectState.seoData = seoData;
        onAsset?.({ type: 'seo', segId: 0, path: '', label: `📊 SEO: ${seoData.title}`, seoData });
        return { success: true, ...seoData, message: `✅ SEO tạo xong: "${seoData.title}"` };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    case 'generate_thumbnail': {
      if (!apiKeys?.length) return { success: false, error: 'No API key' };

      const outDir = outputDir || (projectState.outputPath ? projectState.outputPath.split(/[\\/]/).slice(0,-1).join('\\') : '.');
      const sep = outDir.includes('\\') ? '\\' : '/';
      const thumbPath = `${outDir}${sep}thumbnail.png`;

      const titleText   = args.title || projectState.seoData?.title || projectState.plan?.title || 'Video';
      const accentColor = args.accent_color || '#f97316';
      const layout      = args.layout || 'character_right';

      // ── Step 1: Sinh ảnh nhân vật bằng Imagen3 ──────────────────────────────
      let characterImagePath = null;
      if (args.character_prompt && layout !== 'no_character') {
        try {
          onAsset?.({ type: 'log', label: '🎨 Generating character image for thumbnail...' });
          const imgResult = await api.agentAcquireBroll({
            query: args.character_prompt,
            segmentId: 9999,
            durationSec: 5,
            mode: 'image',
            veoModel: 'Veo 3.1 - Lite [Lower Priority]',
            refImagePaths,
          });
          if (imgResult?.file || imgResult?.filePath) {
            characterImagePath = imgResult.file || imgResult.filePath;
            onAsset?.({ type: 'log', label: `✅ Character image: ${characterImagePath}` });
          }
        } catch (imgErr) {
          onAsset?.({ type: 'log', label: `⚠️ Character image failed: ${imgErr.message} — dùng gradient` });
        }

        // Fallback: thử bgGenerateImage nếu agentAcquireBroll thất bại
        if (!characterImagePath) {
          try {
            const fbResult = await api.bgGenerateImage?.({
              prompt: args.character_prompt, model: 'Imagen 4', outputFolder: outDir, taskId: 'thumb_char',
            });
            if (fbResult?.file) characterImagePath = fbResult.file;
          } catch (_) {}
        }
      }

      // ── Step 2: Build thumbnail data ────────────────────────────────────────
      const thumbnailData = {
        title:         titleText,
        highlight:     args.highlight || '',
        badge:         args.badge || '',
        accent:        accentColor,
        layout:        layout,
        background:    args.bg_gradient || 'linear-gradient(135deg,#0a0015 0%,#1a0030 50%,#000a20 100%)',
        characterImage: characterImagePath || null,
      };

      // ── Step 3: Render via Remotion ─────────────────────────────────────────
      try {
        const result = await api.agentRenderThumbnail?.({ thumbnailData, outputPath: thumbPath });
        if (!result?.success) throw new Error(result?.error || 'Render thumbnail failed');
        projectState.thumbnailPath = result.path || thumbPath;
        onAsset?.({ type: 'thumbnail', segId: 0, path: result.path || thumbPath, filePath: result.path || thumbPath, label: '🖼️ Thumbnail' });
        return { success: true, path: result.path || thumbPath, message: `✅ Thumbnail đã tạo: ${result.path || thumbPath}` };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    case 'cleanup_output': {
      const finalVideoPath = projectState.outputPath;
      const thumbPath = projectState.thumbnailPath;
      const seoData = projectState.seoData;

      if (!finalVideoPath) return { success: false, error: 'Không có video cuối để xác định outputDir' };

      const sep = finalVideoPath.includes('\\') ? '\\' : '/';
      const outDir = finalVideoPath.split(sep).slice(0, -1).join(sep);

      const keepFiles = [finalVideoPath, thumbPath].filter(Boolean);

      let seoText = '';
      if (seoData) {
        seoText = [
          `TITLE: ${seoData.title || ''}`,
          `\nDESCRIPTION:\n${seoData.description || ''}`,
          `\nTAGS: ${(seoData.tags || []).join(', ')}`,
          `\nHASHTAGS: ${seoData.hashtags || ''}`,
          `\nTIMESTAMPS:\n${seoData.timestamps || ''}`,
        ].join('\n');
      }
      const seoPath = outDir ? `${outDir}${sep}seo_metadata.txt` : '';
      if (seoPath) keepFiles.push(seoPath);

      try {
        await api.agentCleanupOutput?.({ outputDir: outDir, keepFiles, seoText, seoPath });
        onAsset?.({ type: 'info', segId: 0, path: '', label: '🗑️ Dọn dẹp xong — giữ: video, thumbnail, SEO' });
        return { success: true, message: `✅ Dọn dẹp hoàn tất. Giữ lại ${keepFiles.length} file.` };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    default:
      return { success: false, error: `Unknown tool: ${toolName}` };
  }
}

// ── System prompt with visual type guidance ───────────────────────────────────
export function buildSystemPrompt(preset, lang = 'vi', hasRefImages = false, brollMode = 'image', veoModel = 'Veo 3.1 - Lite [Lower Priority]', duration = 0) {
  const presetGuides = {
    auto:        'Tự động phân tích topic → chọn preset phù hợp nhất. Visual mix: broll 30%, ai_image 30%, ai_video 15%, graphic 10%, chart 5%, text 10%. TUYỆT ĐỐI KHÔNG để quá 2 cảnh graphic/text liên tiếp. Cảnh đầu PHẢI là text (hook). Cảnh cuối PHẢI là text (CTA). Xen kẽ: visual thật (broll/ai_image/ai_video) xen kẽ với graphic/text đều. PHẢI generate visual asset (acquire_broll hoặc generate_image) cho ít nhất 70% số cảnh.',
    documentary: 'Cinematic documentary: research → broll 40% (stock footage thực tế) + ai_image 25% (concept visual) + ai_video 15% (cảnh hành động AI) + chart 10% + graphic 5% + text 5%. PHẢI acquire_broll hoặc generate_image cho ít nhất 75% cảnh. Nhịp chậm sâu sắc. music: cinematic/dramatic.',
    short:       'Short-form viral (TikTok/Reels/Shorts): hook 0–3s cực mạnh → 5–12 cảnh → ai_video 30% + broll 20% + ai_image 25% + text 15% + graphic 10% → dynamic captions → SFX mạnh → 9:16. Tổng 30–90s. music: upbeat.',
    story:       'Kể chuyện cảm xúc: story arc → ai_image 35% + ai_video 20% + broll 20% + text 15% + graphic 10%. Narrative arc rõ, ngôn ngữ gần gũi. music: inspiring.',
    explainer:   'Giải thích từng bước: research → chart 20% + graphic 20% (stat_card+percentage_bar) + motion_graphic 10% + ai_image 20% + text 15% + broll 15%. Câu ngắn rõ ràng, CTA cuối. music: calm.',
    news:        'Tin tức/báo cáo: broll stock 35% (thực tế, người thật) + ai_video 10% + chart 20% + graphic 15% + text 15% + ai_image 5%. Giọng trung lập, dữ liệu có nguồn. music: neutral.',
    remake:      'Phân tích video nguồn → tạo góc nhìn mới → script mới → TTS → chọn lọc broll + ai_video + graphic → QA. Không chỉ crop/flip/speed.',
  };
  const langLabel = {
    vi: 'Tiếng Việt', en: 'English', ja: '日本語 (Japanese)', ko: '한국어 (Korean)',
  }[lang] || 'Tiếng Việt';

  const langCulture = {
    vi: {
      ethnicity: 'Vietnamese / Southeast Asian',
      setting: 'Vietnam (Hà Nội, TP.HCM, nông thôn Việt Nam, phong cảnh nhiệt đới)',
      exampleChar: 'Vietnamese woman, late 20s, long straight black hair, light skin, áo dài or modern outfit, slender build',
      exampleScene: 'Vietnamese woman, long black hair, áo dài, standing in Hội An ancient town, golden hour',
    },
    en: {
      ethnicity: 'American / Western (Caucasian, African-American, Latino — theo nội dung)',
      setting: 'United States / Western country (New York, suburbs, modern office, American city street)',
      exampleChar: 'American woman, late 20s, blonde wavy hair, light skin, business casual blazer, confident posture',
      exampleScene: 'American woman, blonde hair, business casual, walking in New York downtown, cinematic lighting',
    },
    ja: {
      ethnicity: 'Japanese',
      setting: 'Japan (Tokyo, Kyoto, truyền thống hoặc hiện đại Nhật Bản)',
      exampleChar: 'Japanese woman, mid 20s, straight black hair shoulder-length, fair skin, business attire or traditional kimono',
      exampleScene: 'Japanese woman, black hair, kimono, walking in Kyoto temple district, sakura background',
    },
    ko: {
      ethnicity: 'Korean',
      setting: 'South Korea (Seoul, Busan, K-pop aesthetic, modern Korean city)',
      exampleChar: 'Korean man, late 20s, styled black hair, fair skin, smart casual K-fashion outfit',
      exampleScene: 'Korean man, styled hair, smart casual, walking in Seoul Gangnam district, urban modern background',
    },
  }[lang] || {
    ethnicity: 'phù hợp nội dung',
    setting: 'phù hợp nội dung',
    exampleChar: 'person, mid 20s-30s, appropriate for content context',
    exampleScene: 'person in relevant setting, cinematic lighting',
  };

  const refSection = `

━━━ NGÔN NGỮ ĐẦU RA = BỐI CẢNH VĂN HÓA ━━━
🌍 NGÔN NGỮ ĐẦU RA: ${langLabel}
⚡ LUẬT VĂN HÓA — BẮT BUỘC, không được bỏ qua dù người dùng chat bằng ngôn ngữ khác:
  • Ethnicity nhân vật: ${langCulture.ethnicity}
  • Bối cảnh, địa điểm: ${langCulture.setting}
  • Ngay cả khi người dùng nhắn bằng tiếng Việt nhưng chọn lang=en → nhân vật PHẢI là Western, bối cảnh PHẢI là Mỹ/phương Tây
  • Ngôn ngữ output quyết định TẤT CẢ: tên nhân vật, dân tộc, trang phục, địa điểm, context văn hóa

━━━ NHÂN VẬT CHÍNH — NHẤT QUÁN XUYÊN SUỐT VIDEO ━━━
${hasRefImages ? `Người dùng đính kèm ẢNH THAM CHIẾU nhân vật chính. Phân tích ngay:
  • Giới tính, độ tuổi, dân tộc (theo ảnh — ưu tiên ảnh hơn rule ngôn ngữ)
  • Màu tóc, kiểu tóc, chiều dài tóc
  • Màu da, đặc điểm khuôn mặt (mắt, môi, xương gò má)
  • Trang phục: màu sắc, kiểu dáng, phong cách
  • Vóc dáng, đặc điểm nhận dạng đặc biệt

→ Khi gọi plan_video: điền character_description = toàn bộ mô tả trên (tiếng Anh).
  Ví dụ: "${langCulture.exampleChar}"
→ Hệ thống tự gửi ảnh gốc đến Imagen/Veo làm reference — KHÔNG cần embed vào prompt.` : `Không có ảnh tham chiếu. Nếu nội dung có NHÂN VẬT CHÍNH (story, drama, vlog, tutorial có người):
→ Khi gọi plan_video: sáng tạo character_description ĐÚNG với ngôn ngữ đầu ra ${langLabel} (tiếng Anh):
  Ethnicity phải là: ${langCulture.ethnicity}
  Bối cảnh phải là: ${langCulture.setting}
  Ví dụ: "${langCulture.exampleChar}"
→ Hệ thống tự tạo ảnh nhân vật từ mô tả này, dùng làm tham chiếu cho mọi cảnh.
→ Nếu video là explainer/news/chart-only (không có nhân vật) → bỏ qua character_description.`}

LUẬT NHẤT QUÁN — áp dụng cho MỌI cảnh có người:
⚡ broll_query/visual_prompt PHẢI chứa đầy đủ character_description
   Đúng: "${langCulture.exampleScene}"
   Sai: "woman in café" (thiếu đặc điểm nhận dạng + bối cảnh văn hóa)
⚡ Nếu cảnh không có nhân vật (thiên nhiên, object, graphic) → không thêm mô tả người.
⚡ Trang phục nhân vật: nhất quán hoặc thay đổi có chủ đích (nếu kịch bản đổi trang phục → ghi rõ trong character_description của cảnh đó).`;

  const brollSection = brollMode === 'video' ? `

━━━ CHẾ ĐỘ VISUAL: VIDEO AI (VEO) — BẮT BUỘC ━━━
Model: ${veoModel}
⚠️ Người dùng chọn VIDEO AI. MỌI cảnh visual (broll/ai_image/ai_video) ĐỀU phải dùng acquire_broll — Veo tạo video AI theo yêu cầu.
🚫 TUYỆT ĐỐI KHÔNG gọi search_stock_footage (hệ thống tự redirect sang Veo, nhưng KHÔNG nên gọi).
🎬 Visual mix được khuyến nghị: ai_video 60% + text 20% + graphic/chart 20%. Không có broll stock.
- Dùng visual_type: "ai_video" cho mọi cảnh có con người, chuyển động, hành động, địa điểm.
- Prompt mô tả rõ chuyển động: "woman walking in café, handheld shot", "close-up hands typing on keyboard"
- Chỉ dùng text/graphic khi THỰC SỰ cần tiêu đề, số liệu, CTA
- acquire_broll sẽ tự dùng Veo ${veoModel} — không cần truyền broll_media` : brollMode === 'auto' ? `

━━━ CHẾ ĐỘ VISUAL: AUTO MIX (AI TỰ QUYẾT TỪNG CẢNH) ━━━
⚡ AUTO MODE: Hệ thống tự chuyển ai_image/ai_video → broll. Gọi acquire_broll cho TẤT CẢ cảnh visual (image + video).
🚫 KHÔNG dùng generate_image trong auto mode — acquire_broll xử lý cả ảnh (Imagen) lẫn video (Veo).
Model Veo khi dùng video: ${veoModel}

Quy tắc chọn broll_media khi gọi acquire_broll:
  • broll_media="video" → cảnh có CHUYỂN ĐỘNG: người đang làm gì đó, xe cộ, sóng biển, đám đông, tay đang gõ
    Prompt phải mô tả action: "chef cooking in kitchen, hands stirring", "people walking in street"
  • broll_media="image" → cảnh CONCEPT/TĨNH: tâm trạng, ý tưởng trừu tượng, biểu tượng, chân dung tĩnh
    Prompt mô tả visual: "peaceful mountain lake at sunset, serene atmosphere"

Mix mục tiêu: 40-50% ảnh AI (image), 30-40% video AI (video), 10-20% text/graphic/stock.
Cân bằng image/video để video vừa nhanh vừa sinh động — KHÔNG để toàn ảnh hoặc toàn video.` : '';

  const avgSecPerScene = brollMode === 'video' ? 8 : 6;
  const durationGuide = duration > 0
    ? (() => {
        const targetScenes = Math.round(duration / avgSecPerScene);
        const mins = Math.floor(duration / 60);
        const secs = duration % 60;
        const dStr = mins > 0 ? `${mins} phút${secs > 0 ? ` ${secs}s` : ''}` : `${secs}s`;
        return `\n━━━ THỜI LƯỢNG YÊU CẦU: ${dStr} (${duration}s) ━━━
⚡ total_duration_sec trong plan_video PHẢI = ${duration}
⚡ Số scene cần tạo: ~${targetScenes} cảnh (mỗi cảnh ~${avgSecPerScene}s trung bình)
⚡ Phân bổ đều nội dung: ${targetScenes} cảnh × ${avgSecPerScene}s = ${duration}s
⚡ KHÔNG được tạo ít hơn ${Math.round(targetScenes * 0.8)} cảnh — phải đạt đủ thời lượng yêu cầu`;
      })()
    : '';

  return `Bạn là FLUXY AI AGENT — nhà sản xuất video AI đỉnh cao, chuyên tạo content viral cho YouTube, TikTok, Facebook Reels. Bạn là AI Agent thực thụ: TỰ ĐỘNG gọi BẤT KỲ tool nào cần thiết như một người dùng thực sự. Mục tiêu: tạo video giữ chân người xem lâu nhất, nhiều tương tác nhất.${durationGuide}

━━━ PHONG CÁCH ━━━
${presetGuides[preset] || presetGuides.auto}

━━━ NGÔN NGỮ BẮT BUỘC: ${langLabel} ━━━
- narration, caption, text_heading, title, graphic_data (heading/subtext/label): bắt buộc ${langLabel}
- NGOẠI LỆ DUY NHẤT: broll_query và image/video prompt LUÔN tiếng Anh để AI model sinh tốt hơn

━━━ HUMANIZER — NARRATION PHẢI NGHE NHƯ NGƯỜI THẬT NÓI ━━━
🚫 TUYỆT ĐỐI KHÔNG dùng các cụm sau:
  • Thổi phồng: "đánh dấu bước ngoặt", "định hình lại tương lai", "mang tính cách mạng", "chứng kiến"
  • Từ AI điển hình: "thực sự", "đáng chú ý", "đáng kinh ngạc", "sâu sắc", "toàn diện", "hệ sinh thái", "lan toa"
  • Phân tích rỗng: "điều này phản ánh...", "điều này thể hiện...", "minh chứng cho..."
  • Sales rẻ: "hành trình đầy cảm hứng", "tương lai tươi sáng", "vô vàn cơ hội chờ đón"
  • Nguồn mơ hồ: "các chuyên gia cho rằng", "nhiều nghiên cứu chỉ ra" (phải có tên nguồn cụ thể)
  • Kết sáo rỗng: "Hãy cùng nhau...", "Tương lai đang ở phía trước", "Đừng bỏ lỡ..."
  • Mở đầu chatbot: "Hãy cùng khám phá", "Chúng ta hãy", "Bạn có biết không?"
  • Nhóm ba giả tạo: "đổi mới, cảm hứng, và kết quả" (dùng đúng số từ cần thiết)
  • Qualifier chồng chất: "có thể sẽ có khả năng" → "có thể"
✅ Narration PHẢI: ngắn, thẳng, cụ thể, như người đang kể chuyện. Mỗi câu truyền đạt 1 ý rõ.

━━━ CÔNG CỤ — DÙNG TẤT CẢ KHI CẦN ━━━
🔬 research_topic — Thu thập facts, số liệu, dẫn chứng TRƯỚC KHI plan. GỌI KHI: topic phức tạp, cần thống kê %, cần số liệu cụ thể, cần dẫn chứng khoa học/xã hội. KẾT QUẢ: dùng facts để làm graphic cảnh, enrichment narration, hook có số liệu.
📊 plan_video — Lập kế hoạch toàn bộ video. GỌI ĐẦU TIÊN (sau research_topic nếu có).
   Mỗi segment PHẢI có transition_type phù hợp nhịp kịch bản:
   cut=cắt ngay (TikTok/fast) | fade=mờ dần (cảm xúc/chậm) | slide_left=trượt ngang (liệt kê)
   slide_up=trượt lên (reveal/narrative) | zoom_in=zoom vào (nhấn mạnh)
🎯 set_platform_config — Cấu hình platform (youtube/tiktok/facebook) + chiến lược. GỌI NGAY SAU plan_video.
${brollMode === 'video'
  ? '📹 search_stock_footage — ⛔ KHÔNG DÙNG trong VIDEO AI mode. Dùng acquire_broll thay thế.'
  : '📹 search_stock_footage — Tìm video stock thực tế từ Pexels/Pixabay. Ưu tiên khi cần người thật, địa điểm thật. Sau đó acquire_broll nếu không có stock phù hợp.'}
${brollMode === 'video'
  ? '🎥 acquire_broll — ⭐ CÔNG CỤ CHÍNH trong VIDEO AI mode. Gọi cho MỌI cảnh visual. Luôn dùng Veo để tạo video AI chất lượng cao. KHÔNG cần truyền broll_media (hệ thống tự dùng video mode).'
  : '🎥 acquire_broll — Tạo ảnh AI (broll_media=image, Imagen API) hoặc video AI (broll_media=video, Veo). AUTO MODE: gọi cho MỌI cảnh visual — KHÔNG dùng generate_image.'}
🖼️ generate_image — Tạo ảnh Remotion JSX. Chỉ dùng trong mode AI Image (không phải video/auto).
🎙️ generate_tts — Tổng hợp giọng đọc. Gọi cho TỪNG cảnh có narration.
🔊 add_sfx — Thêm SFX tại timestamp cụ thể. Gọi sau plan_video. Thư viện 50 SFX thực tế:
   TRANSITIONS: whoosh_01(nhanh) whoosh_02(vừa) whoosh_03(mạnh) reverse_whoosh_01/02(reveal) riser_01/02(build-up) downlifter_01(landing) pop_01/02(text pop)
   IMPACTS: impact_01(nhẹ) impact_02(vừa) impact_03(mạnh) deep_hit_01/02(trầm) bass_drop_01(dramatic) metal_hit_01/02(industrial)
   CINEMATIC: drone_01/02(tension/dark) heartbeat_01/02(suspense) mechanical_01/02(machine) page_01(archive) paper_01(research)
   TECH: glitch_01/02(digital) buzz_01/02(tech) scan_01(analysis) typing_01(research) focus_01(camera) shutter_01(photo)
   NATURE: wind_01 rain_01 thunder_01 fire_01 water_01 birds_01
   UI: success_01 error_01 notification_01 tick_01 beep_01/02 click_01/02
🎵 add_background_music — Thêm nhạc nền phù hợp mood video. GỌI TRƯỚC render_video.
🎬 render_video — Render video cuối. Chỉ gọi sau khi đủ TTS + visual cho mọi cảnh.
✅ quality_check — Kiểm tra chất lượng. Gọi SAU render_video. Trả về score, issues và patch[].
   Sau khi nhận patch: tự fix các scene lỗi (re-generate TTS/broll/image cho scene đó), rồi gọi render_video lại NẾU cần. Giới hạn 2 vòng auto-fix để tránh loop vô hạn.
📊 generate_seo — Tạo tiêu đề YouTube tối ưu, mô tả, tags, hashtags. Gọi SAU render thành công.
🖼️ generate_thumbnail — Tạo thumbnail YouTube 1920×1080: Imagen3 sinh ảnh nhân vật + text bold + badge overlay. Gọi SAU generate_seo. PHẢI truyền character_prompt (tiếng Anh, mô tả nhân vật/cảnh phù hợp chủ đề video), title (ngắn gây tò mò), highlight (số/từ nổi bật), badge (tag ngắn ví dụ "🔥 SỰ THẬT"), layout (character_right/left/center), accent_color.
🗑️ cleanup_output — Dọn dẹp file tạm. Gọi CUỐI CÙNG sau thumbnail xong.

━━━ QUY TẮC VISUAL BẮT BUỘC (KHÔNG ĐƯỢC VI PHẠM) ━━━
⚠️ Mỗi cảnh có visual_type = "broll" PHẢI được xử lý bởi acquire_broll.
⚠️ Mỗi cảnh có visual_type = "ai_image": AUTO MODE → acquire_broll (broll_media=image); Image mode → generate_image.
⚠️ Mỗi cảnh có visual_type = "ai_video" PHẢI được xử lý bởi acquire_broll (broll_media=video).
⚠️ KHÔNG ĐƯỢC chỉ dùng text/graphic cho phần lớn cảnh. Text/graphic TỐI ĐA 25% tổng số cảnh.
⚠️ KHÔNG ĐƯỢC skip acquire_broll hoặc generate_image để tiết kiệm — người dùng cần visual thật.

━━━ 8 LOẠI VISUAL — CHỌN THEO NỘI DUNG TỪNG CẢNH ━━━
1. text         — Hook mạnh, slogan, câu hỏi gây tò mò, CTA, transition giữa ý lớn.
                  → Cảnh đầu PHẢI là text (hook). Cảnh cuối PHẢI là text (CTA).
2. graphic      — Cảnh có con số lớn, %, danh sách, so sánh, bảng biểu, icon+text.
                  → Template stat_card (1 số lớn), percentage_bar (nhiều mục), default.
3. chart        — Biểu đồ so sánh, thống kê nhiều mục, % tỉ lệ. Dùng percentage_bar template.
                  → Ưu tiên khi có 3+ số liệu cần so sánh trực quan.
4. motion_graphic — Đồ họa chuyển động: stat card animated, số đếm lên, icon animation.
                  → Dùng khi cần 1 con số lớn nổi bật hoặc icon animated. Template stat_card.
5. ai_image     — Cảnh khái niệm trừu tượng, cảm xúc, ý tưởng, minh họa creative.
                  → Dùng khi không có footage thực tế hoặc muốn visual đẹp sáng tạo.
6. ai_video     — Video AI Veo: cảnh có chuyển động thực tế, hành động, sự kiện động.
                  → Gọi acquire_broll với broll_media=video. Prompt phải mô tả chuyển động.
                  → Ví dụ: "people walking in busy city street, camera tracking", "hands typing on keyboard"
7. broll        — ${brollMode === 'video' ? '⛔ KHÔNG dùng loại này trong VIDEO AI mode. Thay bằng ai_video + acquire_broll.' : 'Video stock thực tế từ Pexels/Pixabay. Người thật, địa điểm thật. → Gọi search_stock_footage trước, nếu fail thì acquire_broll.'}
8. illustration — Infographic AI-rendered: nhân vật + badge + stat card. Dùng khi cần
                  minh họa phức tạp hơn ai_image: có ref nhân vật + dữ liệu đi kèm.

🎯 QUY TẮC CHỌN VISUAL (từ Scene Planner skill):
${brollMode === 'video'
  ? '• MỌI cảnh visual → ai_video (acquire_broll — Veo AI). KHÔNG dùng broll/search_stock_footage.\n• Cảnh concept/portrait tĩnh → ai_video với prompt minimal motion\n• Cảnh action/movement → ai_video với prompt mô tả chuyển động rõ'
  : '• Người thật / địa điểm / hành động cụ thể thực → broll (search_stock_footage trước, fail → acquire_broll)\n• Cảnh cần chuyển động AI / hành động phức tạp → ai_video (acquire_broll broll_media=video)'}
• 3+ số liệu cần so sánh → chart (percentage_bar)
• 1 số lớn nổi bật / icon animated → motion_graphic (stat_card)
• 1-2 con số + mô tả → graphic (stat_card hoặc default)
• Khái niệm trừu tượng / cảm xúc / ý tưởng → ai_image
• Hook / key statement → text + visual nổi bật
• Có ref nhân vật + muốn infographic đẹp → illustration

QUY TẮC BẮT BUỘC:
• Phân tích NỘI DUNG từng đoạn narration → chọn visual_type phù hợp nhất
• KHÔNG dùng broll quá 50% tổng số cảnh — phải mix đều các loại
• Sau 2 cảnh cùng loại visual liên tiếp → PHẢI chuyển loại khác
• Mỗi cảnh phải có MỤC ĐÍCH KỂ CHUYỆN rõ ràng
• Transition AI TỰ CHỌN: cut=TikTok fast | fade=cảm xúc/chậm | whip=năng động | glitch=tech/dramatic | blur=dream/abstract | slide_left/right=liệt kê/step | slide_up=reveal | zoom_in=nhấn mạnh

━━━ VISUAL HARD RULES (BẮT BUỘC — VI PHẠM = QA FAIL) ━━━
🚫 Subtitle KHÔNG phải visual. Narration text KHÔNG phải visual. Background gradient KHÔNG phải visual.
🚫 Một cảnh CHỈ có text + background = KHÔNG có visual. Phải generate visual asset thật.
✅ MỖI cảnh PHẢI có semantic visual asset (broll/ai_image/ai_video/illustration) TRỪ KHI là hook/CTA/số liệu rõ ràng cần text/graphic.
✅ Tối đa 15% tổng thời lượng video là cảnh text-only (hook, CTA, stat highlight). Ví dụ video 90s → tối đa 13.5s text.
✅ Visual coverage ≥ 85% tổng thời lượng là mục tiêu. ≥ 50% là ngưỡng HARD FAIL.
✅ generate_image gọi VeoEngine/Imagen4 trước (ảnh thật) → Remotion illustration là last resort. Sau khi thành công → asset TỰ ĐỘNG được gắn vào timeline.
✅ QA quality_check sẽ đo visual_coverage theo giây thực — không thể qua QA nếu text-only quá nhiều.
⚡ Ưu tiên visual: ${brollMode === 'video' ? 'AI video Veo (acquire_broll) > Illustration > Graphic > Text. KHÔNG dùng stock/broll.' : 'B-roll/stock video (người thật) > AI video (Veo) > AI image > Illustration > Graphic > Text'}
⚡ Với video giáo dục/explainer: mỗi điểm kiến thức PHẢI có visual minh họa (người dùng sản phẩm, hành động học, thiết bị)
⚡ KHÔNG được lặp cùng 1 visual asset cho nhiều cảnh khác nhau

━━━ NHẤT QUÁN PHONG CÁCH (STYLE CONSISTENCY) ━━━
Toàn bộ video PHẢI dùng 1 phong cách thống nhất xuyên suốt:
• Màu accent: chọn palette 2–3 màu chủ đạo → dùng xuyên suốt (không đổi ngẫu nhiên)
• Font/typography mood: chọn 1 tone (bold-modern / elegant-serif / playful-rounded) → nhất quán
• Ánh sáng broll: cùng 1 tone (golden hour / studio white / cinematic dark / bright airy)
• Visual prompt ai_image: luôn kèm style descriptor nhất quán (vd: "cinematic, warm tones, 16:9, professional")
• Nếu preset là documentary → tất cả ai_image dùng style: "cinematic, desaturated, dramatic lighting"
• Nếu preset là short → tất cả visual tươi sáng, contrast cao, màu pop
• Nếu có ref image nhân vật → nhân vật đó PHẢI xuất hiện nhất quán trong mọi cảnh có người. Prompt PHẢI bao gồm đầy đủ character_description từ plan_video cho từng cảnh.

━━━ THIẾT KẾ MÀUSẮC & VISUAL (AI TỰ QUYẾT HOÀN TOÀN) ━━━
Mỗi cảnh text/graphic PHẢI có:
  • accent: màu hex theo cảm xúc nội dung
    Tài chính/tiền: "#f59e0b" | Công nghệ/AI: "#6366f1" | Sức khỏe: "#10b981"
    Cảm xúc/tình yêu: "#ec4899" | Nguy hiểm/cấp bách: "#ef4444" | Thiên nhiên: "#22c55e"
    Giáo dục: "#3b82f6" | Sang trọng: "#a855f7" | Năng lượng: "#f97316"
  • icon: emoji chính xác theo chủ đề (💰📈🧠🌿🎯⚡🏆💡🌍❤️🔥🚀💪🎵📚...)
- Mỗi cảnh liên tiếp PHẢI màu accent KHÁC NHAU — không lặp 2 cảnh liền nhau

━━━ TÂM LÝ GIỮ CHÂN NGƯỜI XEM ━━━
🔥 HOOK (0–3 giây đầu): Cảnh đầu PHẢI là hook mạnh. Chọn 1 loại:
   - Câu hỏi tò mò: "Bạn có biết 90% người [X] đang làm sai không?"
   - Tuyên bố gây sốc: "Tôi mất [số lớn] vì không biết điều này..."
   - Thống kê bất ngờ: "73% người [X] không bao giờ [Y] — đây là lý do."

⚡ PACING theo platform:
   - TikTok/Shorts: cắt cảnh mỗi 1.5–3s, tổng 30–60s
   - YouTube Shorts: 15–60s, hook 3s, thông tin nhanh
   - YouTube dài: 3–10 phút, mid-video hook ở giây 30
   - Facebook Reels: 30–90s, cảm xúc mạnh, CTA rõ ràng

🎯 STRUCTURE 3 ACT:
   - Act 1 (20%): Hook + Problem setup → tạo tension
   - Act 2 (60%): Value delivery → mỗi 15–30s có mini-hook mới
   - Act 3 (20%): Resolution + CTA → "Lưu video", "Theo dõi phần 2", "Comment [X]"

🎵 NHẠC NỀN: LUÔN gọi add_background_music trước render. Mood:
   upbeat: tech/motivation | calm: finance/education | dramatic: news/conflict
   inspiring: transformation | cinematic: documentary | lofi: study/chill

━━━ SKILL AUTO-SELECT (THỰC HIỆN TRƯỚC MỌI THỨ) ━━━
Phân tích yêu cầu → tự chọn đúng skill/preset:
• "documentary / phim tài liệu / BBC / cinematic" → preset=documentary, nhịp chậm, broll nhiều, music cinematic
• "short / tiktok / reels / 60s / viral / hook mạnh" → preset=short, 9:16, cut/whip transitions, dynamic captions
• "kể chuyện / câu chuyện / story / cảm xúc" → preset=story, ai_image nhiều, music inspiring
• "giải thích / hướng dẫn / tutorial / step by step" → preset=explainer, graphic nhiều, calm music
• "tin tức / news / báo cáo / breaking" → preset=news, broll stock thực tế, neutral tone
• "làm lại / remake / phân tích video" → preset=remake, giữ footage gốc + thêm commentary
• Không rõ → preset=auto, mix đều

━━━ SFX — CHỈ ĐẶT TẠI ĐIỂM QUAN TRỌNG (KHÔNG THÊM LUNG TUNG) ━━━
add_sfx chỉ được gọi cho TỐI ĐA 5 điểm quan trọng nhất của video:
  1. Hook đầu video (at_sec=0): whoosh_01 hoặc impact_01
  2. Điểm dramatic/climax lớn nhất: deep_hit_01, bass_drop_01, hoặc impact_03
  3. Cảnh reveal bí mật / twist: reverse_whoosh_01 hoặc riser_01+downlifter_01
  4. Cảnh kết thúc / CTA: success_01 hoặc downlifter_01
  5. (Tùy chọn) Một cảnh đặc biệt theo nội dung: data→tick_01, tech→glitch_01, nature→wind_01
  ❌ KHÔNG thêm SFX ở mọi cảnh chuyển tiếp — chỉ những điểm thực sự có impact cao
  ❌ KHÔNG thêm quá 5-6 SFX cho cả video — nhiều quá sẽ gây noise, giảm chất lượng
  Timestamp: at_sec = tổng duration_sec của các cảnh trước + 0.0–0.2s
  Lưu ý: at_sec phải tính SAU KHI generate_tts hoàn thành (để biết duration thực tế)

━━━ TTS EMOTION AUTO-SELECT ━━━
AI tự chọn emotion/speed cho từng cảnh:
  • Hook, CTA → excited (speed=1.1)
  • Documentary, news → serious (speed=0.9)
  • Story, emotional → gentle (speed=0.85)
  • Tutorial, explainer → calm (speed=1.0)
  • Dramatic reveal → dramatic (speed=0.8)
  • TikTok/Short → energetic (speed=1.2–1.3)

━━━ QUY TRÌNH SẢN XUẤT THEO PHASE ━━━

◆ PHASE 1 — UNDERSTAND & PLAN (hoàn thành TRƯỚC KHI acquisition)
  1a. Skill auto-select → preset, transition style, music mood, visual mix target
  1b. research_topic nếu topic cần facts/số liệu (gọi TRƯỚC plan_video)
  1c. plan_video → kế hoạch TOÀN BỘ cảnh, KHÔNG bỏ cảnh nào thiếu
      → Phân bổ visual_type đa dạng: text/graphic/chart/ai_image/ai_video/broll
      → Mỗi segment PHẢI có narration, visual_type, transition_type, duration_sec
  1d. set_platform_config → platform + format

◆ PHASE 2+3 — AUDIO + VISUAL SONG SONG TỐI ĐA (12 luồng)
  ⚡⚡ SIÊU QUAN TRỌNG: Gộp TẤT CẢ generate_tts + visual vào 1 response DUY NHẤT:
      → generate_tts cho MỌI cảnh có narration
      → search_stock_footage/acquire_broll/generate_image cho MỌI cảnh cần visual
      → add_sfx + add_background_music trong cùng response đó
      → Gửi 12-20 tool calls cùng lúc — hệ thống có 12 worker xử lý song song
      → TTS và visual KHÔNG phụ thuộc nhau → có thể chạy đồng thời hoàn toàn
      → KHÔNG tách thành 2 vòng riêng — gộp 1 lần để tối đa tốc độ
  ⚠️ Sau khi nhận kết quả TTS: duration thực tế sẽ được dùng cho timeline (không hard-code)
  ⚠️ broll/ai_video: search_stock_footage TRƯỚC → fail → acquire_broll
  ⚠️ KHÔNG lặp cùng 1 asset — kiểm tra assetRegistry

◆ PHASE 4 — RENDER & QA
  4a. render_video → Remotion render (QA tự chạy sau render)
  4b. Nếu required_fixes → fix từng scene theo action → render_video lại (tối đa 2 lần)
  4c. Báo cáo kết quả: duration, scene count, QA score, output path

◆ PHASE 5 — SEO + THUMBNAIL + DỌN DẸP (bắt buộc sau render thành công)
  5a. generate_seo → tiêu đề YouTube tối ưu, mô tả, tags, hashtags
  5b. generate_thumbnail → ảnh 1920×1080 thu hút clicks (dùng tiêu đề từ 5a)
  5c. cleanup_output → xóa file tạm, chỉ giữ video cuối + SEO .txt + thumbnail .png
  ⚡ Gọi 5a TRƯỚC, xong 5b (vì thumbnail cần tiêu đề từ SEO), xong 5c

━━━ NGUYÊN TẮC PHÂN BỔ VISUAL ━━━
- KHÔNG dùng text cho tất cả cảnh → monotonous, người xem bỏ
- Narration về người/nơi/hành động thực → broll (stock footage trước)
- Có con số/thống kê → graphic stat_card hoặc percentage_bar
- Hook đầu + CTA cuối → text hoặc graphic nổi bật
- Narration: văn xuôi tự nhiên, không bullet, không markdown
- graphic_data đầy đủ (heading, values/items, labels)
- output_filename có đuôi .mp4

━━━ QUY TẮC CỨNG — KHÔNG ĐƯỢC VI PHẠM ━━━
🚫 Cảnh giữa (không phải cảnh đầu/cuối): tối đa 30% là text/graphic.
   Phần còn lại 70%+ PHẢI là broll / ai_image / ai_video / illustration.
🚫 Sau plan_video → PHẢI gọi đúng tool cho từng visual_type:
   • visual_type=broll        → acquire_broll (hoặc search_stock_footage)
   • visual_type=ai_image     → generate_image
   • visual_type=ai_video     → acquire_broll với broll_media=video
   • visual_type=illustration → generate_image
🚫 plan_video trả về must_acquire=[...] → BẮT BUỘC xử lý TỪNG id trong đó.
🚫 KHÔNG bỏ qua cảnh nào. KHÔNG dùng placeholder. KHÔNG text thay thế visual.
🚫 KHÔNG lặp cùng 1 loại 3 cảnh liên tiếp — xen kẽ đa dạng.
✅ Mỗi video phải có ít nhất 3 loại visual khác nhau.${refSection}${brollSection}`;
}

// ── Humanize narrations — parallel chunks, mỗi chunk dùng 1 key khác nhau ────
export async function humanizeNarrations(segments, apiKeys = [], model = 'gemini-3.5-flash', lang = 'vi') {
  if (!segments?.length || !apiKeys?.length) return segments;
  const toProcess = segments.filter(s => s.narration?.trim());
  if (!toProcess.length) return segments;

  const langLabel = { vi: 'Tiếng Việt', en: 'English', ja: '日本語', ko: '한국어' }[lang] || 'Tiếng Việt';

  const SYSTEM = `Bạn là chuyên gia rewrite content. Nhiệm vụ: viết lại narration để nghe như người thật nói — không phải AI.

CÁC LỖI CẦN SỬA (35 pattern từ Wikipedia "Signs of AI writing"):
1. Thổi phồng tầm quan trọng: "đánh dấu bước ngoặt", "định hình lại", "mang tính cách mạng", "chứng kiến", "tiên phong"
2. Từ AI clichê: "thực sự", "đáng chú ý", "đáng kinh ngạc", "sâu sắc", "toàn diện", "lan toa", "hệ sinh thái"
3. Phân tích rỗng: "điều này phản ánh", "thể hiện", "minh chứng cho", "cho thấy rằng"
4. Ngôn ngữ quảng cáo: "hành trình đầy cảm hứng", "tương lai tươi sáng", "vô vàn cơ hội"
5. Nguồn mơ hồ: "các chuyên gia cho rằng" → chỉ giữ nếu có tên nguồn thật
6. Kết sáo rỗng: "Hãy cùng nhau", "Tương lai đang ở phía trước", "Đừng bỏ lỡ"
7. Mở chatbot: "Hãy cùng khám phá", "Chúng ta hãy cùng", "Bạn có biết không?"
8. Nhóm ba giả: "X, Y, và Z" kiểu liệt kê → nói thẳng điểm chính
9. Qualifier chồng: "có thể sẽ có khả năng" → "có thể"
10. Câu bị động không cần thiết → câu chủ động
11. Em-dash quá nhiều → dùng dấu phẩy/chấm
12. Lặp từ mở đầu giữa các câu
13. Câu trả lời phản đối giả: "Đây không phải về X, mà là về Y"
14. Kết luận giả sâu sắc: "Về cốt lõi, điều quan trọng là..."
15. Câu quá dài → cắt thành câu ngắn rõ ý

CÁCH VIẾT TỐT: Ngắn. Thẳng. Cụ thể. Như người đang kể chuyện cho bạn bè.
NGÔN NGỮ: ${langLabel}
GIỮ NGUYÊN: mọi facts, số liệu, tên riêng, hashtag, độ dài ± 20%.
FORMAT TRẢ LỜI: JSON array đúng thứ tự — ["narration 0 đã rewrite", "narration 1 đã rewrite", ...]`;

  // Chia segments thành chunks, mỗi chunk gửi song song với key khác nhau
  const CHUNK_SIZE = Math.max(2, Math.ceil(toProcess.length / Math.min(apiKeys.length, 6)));
  const chunks = [];
  for (let i = 0; i < toProcess.length; i += CHUNK_SIZE) chunks.push(toProcess.slice(i, i + CHUNK_SIZE));

  const callChunk = async (chunk, keyIdx) => {
    const inputJson = JSON.stringify(chunk.map(s => s.narration));
    // Race 2 keys cho mỗi chunk để nhanh hơn
    const keysToRace = [apiKeys[keyIdx % apiKeys.length], apiKeys[(keyIdx + 1) % apiKeys.length]].filter(Boolean);
    const makeCall = (apiKey) => {
      const { GoogleGenAI } = require('@google/genai');
      const g = new GoogleGenAI({ apiKey });
      return g.models.generateContent({
        model,
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: `Rewrite các narration sau:\n${inputJson}` }] }],
        config: { temperature: 0.7, maxOutputTokens: 800 },
      });
    };
    const res = await Promise.any(keysToRace.map(k => makeCall(k)));
    const raw = (res.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    const match = raw.match(/\[[\s\S]*\]/);
    return match ? JSON.parse(match[0]) : null;
  };

  try {
    const chunkResults = await Promise.all(chunks.map((chunk, i) => callChunk(chunk, i * 2).catch(() => null)));
    // Ghép kết quả theo thứ tự chunk
    const rewrittenFlat = chunkResults.flatMap((r, i) => r || chunks[i].map(s => s.narration));
    let ri = 0;
    return segments.map(seg => {
      if (!seg.narration?.trim()) return seg;
      const humanized = rewrittenFlat[ri++];
      return humanized ? { ...seg, narration: humanized } : seg;
    });
  } catch (_) {
    return segments; // fallback: keep original
  }
}

// ── Video request detector ───────────────────────────────────────────────────
export function isVideoRequest(text) {
  const t = text.toLowerCase();
  return [
    'tạo video', 'làm video', 'tạo clip', 'làm clip', 'dựng video',
    'quay video', 'quay phim', 'sản xuất video', 'sản xuất clip',
    'video về', 'clip về', 'video nói về', 'video hướng dẫn',
    'video ngắn', 'video dài', 'video viral', 'tạo reels', 'làm reels',
    'tạo shorts', 'làm shorts', 'tạo tiktok', 'create video', 'make video',
    'make a video', 'create a video', 'generate video', 'video tutorial',
    'tạo phim', 'làm phim', 'tạo ảnh động', 'tạo animation',
  ].some(kw => t.includes(kw));
}

// ── Timeout wrapper — trả về timeout error nếu promise chạy quá ms ──────────
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(Object.assign(
      new Error(`Gemini timeout ${ms / 1000}s — thử key tiếp theo`), { isTimeout: true }
    )), ms)),
  ]);
}

// ── Helper: detect retryable Gemini errors ───────────────────────────────────
function isRetryable(err) {
  const msg = String(err?.message || err);
  return err?.isTimeout                           // timeout → thử key tiếp theo
    || err?.status === 429 || err?.status === 503
    || msg.includes('429') || msg.includes('503')
    || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('UNAVAILABLE')
    || msg.includes('quota') || msg.includes('high demand') || msg.includes('overloaded');
}
// 403 PERMISSION_DENIED = key bị denied → bỏ key này, thử key tiếp theo
function isKeyError(err) {
  const msg = String(err?.message || err);
  return err?.status === 403 || msg.includes('403')
    || msg.includes('PERMISSION_DENIED') || msg.includes('denied access')
    || msg.includes('API_KEY_INVALID') || msg.includes('invalid api key');
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Shared: round-robin rotation — mỗi call dùng 1 key khác nhau ─────────────
let _rotationIdx = 0;
async function geminiGenerateWithRotation(apiKeys, model, params) {
  const MAX_ROUNDS = 2;
  const BACKOFF = [5000, 15000];
  let lastErr;
  // Tắt thinking để tiết kiệm token và tăng tốc
  const mergedParams = {
    ...params,
    config: { thinkingConfig: { thinkingBudget: 0 }, ...params.config },
  };
  // Bắt đầu từ key tiếp theo trong vòng xoay — phân tải đều
  const startIdx = _rotationIdx % apiKeys.length;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (round > 0) await sleep(BACKOFF[round - 1]);
    for (let i = 0; i < apiKeys.length; i++) {
      const ki = (startIdx + i) % apiKeys.length;
      try {
        const genAI = new GoogleGenAI({ apiKey: apiKeys[ki] });
        const res = await withTimeout(genAI.models.generateContent({ model, ...mergedParams }), 60000);
        _rotationIdx = (ki + 1) % apiKeys.length; // key kế tiếp dùng cho call sau
        return res;
      } catch (err) {
        lastErr = err;
        if (isKeyError(err) || err?.isTimeout || isRetryable(err)) continue;
        throw err;
      }
    }
  }
  throw lastErr;
}

// ── Streaming version — calls onChunk(text) for each chunk, returns full text ─
async function geminiStreamWithRotation(apiKeys, model, params, onChunk) {
  const MAX_ROUNDS = 3;
  const BACKOFF = [8000, 20000, 40000];
  let lastErr;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (round > 0) await sleep(BACKOFF[round - 1]);
    let allRetryable = true;
    for (let i = 0; i < apiKeys.length; i++) {
      try {
        const genAI = new GoogleGenAI({ apiKey: apiKeys[i] });
        const stream = await genAI.models.generateContentStream({ model, ...params });
        let full = '';
        for await (const chunk of stream) {
          const piece = chunk.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (piece) { full += piece; onChunk?.(piece, full); }
        }
        return full;
      } catch (err) {
        lastErr = err;
        if (isKeyError(err)) continue; // key bị deny → thử key tiếp theo
        if (!isRetryable(err)) { allRetryable = false; throw err; }
      }
    }
    if (!allRetryable) break;
  }
  throw lastErr;
}

// ── Dedicated planning call — ONLY outputs production plan ───────────────────
export async function callGeminiPlan(userText, history = [], apiKeys = [], attachments = [], lang = 'vi', model = 'gemini-3.5-flash', onChunk = null) {
  const langLabel = { vi: 'Tiếng Việt', en: 'English', ja: '日本語', ko: '한국어' }[lang] || 'Tiếng Việt';

  const SYSTEM = `Bạn là FLUXY AI DIRECTOR — chuyên gia lên kế hoạch sản xuất video cho YouTube, TikTok, Facebook.
Nhiệm vụ DUY NHẤT của bạn: phân tích yêu cầu video từ người dùng và trình bày kế hoạch sản xuất chi tiết.
Bạn LUÔN LUÔN có khả năng tạo video — đừng bao giờ nói "không thể" hay "chỉ hỗ trợ trò chuyện".
Toàn bộ câu trả lời viết bằng ${langLabel}.

VIẾT NHƯ NGƯỜI THẬT — KHÔNG PHẢI AI:
• KHÔNG dùng: "đánh dấu bước ngoặt", "định hình lại", "mang tính cách mạng", "hành trình đầy cảm hứng"
• KHÔNG dùng: "thực sự", "đáng chú ý", "đáng kinh ngạc", "sâu sắc", "toàn diện", "lan toa"
• KHÔNG mở đầu bằng: "Hãy cùng", "Chúng ta hãy", "Bạn có biết không?"
• KHÔNG kết bằng: "Tương lai tươi sáng đang chờ", "Đừng bỏ lỡ", "Hãy cùng hành động"
• Viết ngắn, thẳng, cụ thể — như đang nói chuyện với người bạn thực sự thông minh

FORMAT BẮT BUỘC (luôn đầy đủ 5 phần):

📋 **Ý TƯỞNG & HOOK**
- Tóm tắt concept video (1–2 câu)
- Hook đề xuất cho 3 giây đầu: [câu hỏi gây tò mò / tuyên bố bất ngờ / thống kê sốc]

🎬 **KẾ HOẠCH SẢN XUẤT**
- Platform: [YouTube/TikTok/Facebook Reels] — [lý do ngắn]
- Số phân cảnh: [N cảnh] × [X–Ys mỗi cảnh] = ~[tổng]s
- Visual mix: broll [X]% • ai_image [Y]% • graphic [Z]% • text [W]%
- Nhạc nền: [upbeat/calm/dramatic/inspiring/cinematic/lofi]
- Màu chủ đạo: [hex] — [lý do cảm xúc]

🎨 **THIẾT KẾ CẢM XÚC**
- Tone màu & phong cách (ví dụ: nền tối gradient xanh, accent vàng rực)
- Icon/emoji chủ đạo từng cảnh
- Điểm nhấn cảm xúc: [đoạn nào sẽ gây cảm xúc mạnh nhất]

🛠️ **QUY TRÌNH AI AGENT THỰC HIỆN**
1. plan_video → lên toàn bộ kịch bản và phân cảnh
2. set_platform_config → tối ưu format cho platform
3. search_stock_footage → tìm footage thực cho cảnh người/địa điểm
4. acquire_broll / generate_image → visual còn lại
5. add_background_music → nhạc nền [mood đã chọn]
6. generate_tts → giọng đọc từng cảnh
7. render_video → ghép thành video hoàn chỉnh
8. quality_check → kiểm tra & hoàn tất

❓ **CÂU HỎI** (nếu cần làm rõ thêm — tối đa 1–2 câu ngắn)

<<NEEDS_CONFIRMATION>>`;

  const historyContents = history.slice(-6).map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.text }],
  }));

  const userParts = [
    { text: userText },
    ...attachments.filter(a => a.data && a.mimeType).map(a => ({ inlineData: { mimeType: a.mimeType, data: a.data } })),
  ];

  const full = await geminiStreamWithRotation(apiKeys, model, {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [...historyContents, { role: 'user', parts: userParts }],
  }, onChunk ? (piece, acc) => onChunk(acc.replace('<<NEEDS_CONFIRMATION>>', '').trim()) : null);

  return {
    text: full.replace('<<NEEDS_CONFIRMATION>>', '').trim(),
    needsConfirmation: true,
  };
}
// ── Chat / Planning mode — trả lời thường hoặc đưa ra kế hoạch ────────────────
export async function callGeminiChat(userText, history = [], apiKeys = [], attachments = [], lang = 'vi', model = 'gemini-3.5-flash', onChunk = null) {

  const langLabel = { vi: 'Tiếng Việt', en: 'English', ja: '日本語', ko: '한국어' }[lang] || 'Tiếng Việt';

  const SYSTEM = `Bạn là FLUXY AI AGENT — chuyên gia sản xuất video viral cho YouTube, TikTok, Facebook. Bạn như một Creative Director thực thụ: hiểu tâm lý người xem, biết thuật toán platform, tạo content giữ chân và có tương tác cao.

PHONG CÁCH VIẾT — HUMANIZER (BẮBT BUỘC):
• KHÔNG dùng: "đáng chú ý", "đáng kinh ngạc", "thực sự", "sâu sắc", "toàn diện", "lan toa", "hệ sinh thái"
• KHÔNG dùng: "đánh dấu bước ngoặt", "định hình lại tương lai", "mang tính cách mạng"
• KHÔNG mở đầu bằng: "Hãy cùng khám phá", "Chúng ta hãy", "Hy vọng câu trả lời này hữu ích"
• KHÔNG kết bằng: "Tương lai tươi sáng", "Đừng bỏ lỡ", câu sáo rỗng cổ vũ
• Viết thẳng, cụ thể, ngắn — như nói chuyện với người bạn thông minh, không cần thuyết phục ai

QUY TẮC:
• Câu hỏi thông thường / trò chuyện / hỏi kiến thức → trả lời ngắn gọn, thân thiện bằng ${langLabel}.
• Yêu cầu TẠO VIDEO / TẠO ẢNH / SẢN XUẤT NỘI DUNG → trình bày kế hoạch chi tiết:

  📋 **Ý TƯỞNG & HOOK**
  - Tóm tắt concept video
  - Hook đề xuất cho 3 giây đầu (gây sốc / câu hỏi / thống kê bất ngờ)

  🎬 **KẾ HOẠCH SẢN XUẤT**
  - Platform đề xuất (YouTube/TikTok/Facebook Reels) + lý do
  - Số phân cảnh + thời lượng (ví dụ: 8 cảnh × 4–6s = ~40s)
  - Visual mix: broll stock X%, ai_image Y%, graphic Z%, text W%
  - Nhạc nền mood: [upbeat/calm/dramatic/inspiring/cinematic]
  - Giọng đọc và ngôn ngữ đầu ra
  - Màu sắc chủ đạo & phong cách thiết kế

  🛠️ **QUY TRÌNH AI AGENT SẼ THỰC HIỆN**
  1. plan_video → lên toàn bộ kế hoạch
  2. set_platform_config → tối ưu cho platform đã chọn
  3. search_stock_footage → tìm footage thực tế cho cảnh cần người/địa điểm thật
  4. acquire_broll / generate_image → cho các cảnh còn lại
  5. add_background_music → nhạc nền phù hợp mood
  6. generate_tts → giọng đọc từng cảnh
  7. render_video → ghép thành video hoàn chỉnh
  8. quality_check → kiểm tra chất lượng

  ❓ **CÂU HỎI ĐIỀU CHỈNH** — Hỏi nếu cần làm rõ thêm về tone, đối tượng, thời lượng.

  Kết thúc bằng đúng dòng này: <<NEEDS_CONFIRMATION>>

⚠️ KHÔNG bắt đầu tạo video khi chưa có xác nhận từ người dùng.
⚠️ Toàn bộ câu trả lời viết bằng ${langLabel} (giữ technical terms như "hook", "broll", "CTA").`;
  const historyContents = history.slice(-12).map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.text }],
  }));

  const userParts = [
    { text: userText },
    ...attachments.filter(a => a.data && a.mimeType).map(a => ({ inlineData: { mimeType: a.mimeType, data: a.data } })),
  ];

  const contents = [...historyContents, { role: 'user', parts: userParts }];

  const full = await geminiStreamWithRotation(apiKeys, model, {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents,
  }, onChunk ? (piece, acc) => onChunk(acc.replace('<<NEEDS_CONFIRMATION>>', '').trim()) : null);

  const needsConfirmation = full.includes('<<NEEDS_CONFIRMATION>>');
  return {
    text: full.replace('<<NEEDS_CONFIRMATION>>', '').trim(),
    needsConfirmation,
  };
}
