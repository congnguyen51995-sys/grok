/**
 * AI Agent Service — Gemini function-calling tool definitions & executor
 */
import { GoogleGenAI } from '@google/genai';
import { synthesizeBgmToWav, moodToTrack } from './bgmSynth.js';
// SEO YouTube dùng chung cơ chế của tab Sáng Tác (tiêu đề chấm điểm, mô tả, tags, chapters từ SRT)
import { generateSeoMetadata } from '../components/CreatorStudio';

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
                enum: ['broll','ai_image','illustration','graphic','chart','motion_graphic','text'],
                description: 'Loại visual. broll=video stock Pexels/Pixabay (cảnh thực tế, hành động, người thật); ai_image=ảnh AI Imagen + Ken Burns PHẢI LÀ object/concept/landscape (tiền, vàng, bất động sản, biểu đồ ánh sáng, thiên nhiên) — KHÔNG được là người/nhân vật; illustration=infographic nhân vật; graphic=infographic dữ liệu; chart=biểu đồ thống kê; motion_graphic=đồ họa chuyển động; text=hook/transition/CTA card',
              },
              broll_query:  { type: 'STRING', description: 'Mô tả VISUAL cụ thể cho cảnh (tiếng Anh). PHẢI mô tả HỌA TIẾT/VẬT THỂ cụ thể, KHÔNG dùng từ chung chung như "businessman" hay "person". ai_image: mô tả concept/metaphor (VD: "golden coins waterfall, abundance concept", "compound interest graph glowing blue", "stack of gold bars luxury bokeh", "real estate buildings sunset aerial"). broll=video: hành động cụ thể (VD: "hands counting money close-up", "stock chart screen reflection")' },
              broll_media:  { type: 'STRING', enum: ['image','video'], description: 'Chế độ acquire_broll (chỉ dùng khi mode=auto). image=ảnh AI Imagen + Ken Burns (concept/chân dung/abstract); video=stock Pexels/Pixabay (cảnh thực tế/hành động)' },
              visual_prompt:{ type: 'STRING', description: 'Prompt tạo ảnh AI (chỉ cần khi visual_type=ai_image)' },
              visual_motion:{ type: 'STRING', enum: ['slow_zoom','ken_burns','pan_right','static','zoom_out'] },
              transition_type: {
                type: 'STRING',
                enum: ['fade','slide_left','slide_right','slide_up','slide_down','zoom_in','zoom_out','cut','whip','glitch','blur'],
                description: 'Kiểu chuyển cảnh. AI TỰ CHỌN theo nhịp: fade=cảm xúc/chậm; slide_left/right=liệt kê/step; slide_up=reveal/narrative; zoom_in=nhấn mạnh; zoom_out=reveal rộng; cut=fast TikTok; whip=năng động cao; glitch=tech/digital/dramatic; blur=dream/abstract. Documentary→fade. Short→cut/whip. Dramatic reveal→glitch.',
              },
              graphic_template: {
                type: 'STRING',
                enum: ['default','stat_card','percentage_bar','timeline_flow'],
                description: 'Template infographic (khi visual_type=graphic/chart/motion_graphic). stat_card=số liệu lớn đếm lên (dùng values+labels); percentage_bar=cột % horizontal fill (dùng items=[{label,value%}]); timeline_flow=các bước quy trình slide-in (dùng steps=[]); default=icon+heading+subtext.',
              },
              graphic_data: {
                type: 'OBJECT',
                description: 'DỮ LIỆU BẮT BUỘC cho graphic. stat_card: {label:"Tiêu đề",values:[123,456,789],labels:["Nhãn A","Nhãn B","Nhãn C"]}. percentage_bar: {label:"Tiêu đề",items:[{label:"Người giàu",value:80},{label:"Người nghèo",value:20}]}. timeline_flow: {label:"Tiêu đề",steps:["Bước 1","Bước 2","Bước 3"]}. default: {heading:"Câu lớn",subtext:"Mô tả",icon:"💰"}. PHẢI điền đúng format tương ứng template.',
                properties: {
                  label:   { type: 'STRING' },
                  heading: { type: 'STRING' },
                  subtext: { type: 'STRING' },
                  icon:    { type: 'STRING' },
                  values:  { type: 'ARRAY', items: { type: 'NUMBER' } },
                  labels:  { type: 'ARRAY', items: { type: 'STRING' } },
                  items:   { type: 'ARRAY', items: { type: 'OBJECT', properties: { label: { type: 'STRING' }, value: { type: 'NUMBER' } } } },
                  steps:   { type: 'ARRAY', items: { type: 'STRING' } },
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
        outline: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Dàn ý TOÀN BỘ video theo thứ tự (5–10 phần, mỗi phần 1 câu ngắn). BẮT BUỘC với video ≥ 3 phút — extend_plan sẽ viết tiếp các cảnh theo dàn ý này.',
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
    description: 'Lấy visual cho 1 phân cảnh. CHỈ dùng khi cần lấy từng cảnh riêng lẻ hoặc cảnh video stock (broll_media=video). Cho ảnh AI: dùng batch_acquire_images thay thế để xử lý song song nhanh hơn.',
    parameters: {
      type: 'OBJECT',
      properties: {
        segment_id:  { type: 'NUMBER' },
        query:       { type: 'STRING', description: 'Mô tả cảnh cần (tiếng Anh, ngắn gọn): "wealthy businessman office", "stock market trading floor"' },
        duration_sec:{ type: 'NUMBER', description: 'Thời lượng cần (giây)' },
        broll_media: { type: 'STRING', enum: ['image','video'], description: 'image=ảnh AI Imagen (Ken Burns effect, cho concept/chân dung/abstract); video=stock Pexels/Pixabay (cho cảnh thực tế/hành động). Bắt buộc khi mode=auto.' },
      },
      required: ['segment_id','query'],
    },
  },

  {
    name: 'batch_acquire_images',
    description: '⭐ DÙNG THAY acquire_broll KHI TẠO ẢNH AI. Gửi 8 luồng IPC song song, VeoEngine tự serialize qua mutex. Dùng khi broll_media=image cho nhiều cảnh. CHỈ cho ảnh — cảnh video stock vẫn dùng acquire_broll(broll_media=video).',
    parameters: {
      type: 'OBJECT',
      properties: {
        segments: {
          type: 'ARRAY',
          description: 'Danh sách tất cả phân cảnh cần tạo ảnh AI. Điền đầy đủ tất cả cảnh image trong 1 lần gọi.',
          items: {
            type: 'OBJECT',
            properties: {
              segment_id:  { type: 'NUMBER' },
              query:       { type: 'STRING', description: 'Mô tả cảnh (tiếng Anh): "gold coins waterfall", "stock market chart rising"' },
              duration_sec:{ type: 'NUMBER' },
            },
            required: ['segment_id','query'],
          },
        },
      },
      required: ['segments'],
    },
  },

  {
    name: 'batch_search_stock',
    description: '⭐ DÙNG THAY search_stock_footage KHI CẦN NHIỀU VIDEO STOCK. Tìm và tải 8-10 video stock song song từ Pexels/Pixabay. Gộp TẤT CẢ cảnh video stock vào 1 lần gọi duy nhất. CHỈ cho video — cảnh ảnh AI dùng batch_acquire_images.',
    parameters: {
      type: 'OBJECT',
      properties: {
        segments: {
          type: 'ARRAY',
          description: 'Danh sách tất cả phân cảnh cần video stock. Gộp tất cả vào 1 lần gọi.',
          items: {
            type: 'OBJECT',
            properties: {
              segment_id:  { type: 'NUMBER' },
              query:       { type: 'STRING', description: 'Từ khóa tìm kiếm tiếng Anh: "businessman walking office", "city skyline night"' },
              duration_sec:{ type: 'NUMBER' },
              provider:    { type: 'STRING', enum: ['pexels','pixabay','both','dvids'], description: 'Nguồn stock, default "both". "dvids"=footage quân sự Mỹ mới nhất' },
            },
            required: ['segment_id','query'],
          },
        },
      },
      required: ['segments'],
    },
  },

  {
    name: 'batch_acquire_all',
    description: '⭐⭐ CÔNG CỤ VISUAL CHÍNH — Xử lý TẤT CẢ visual (ảnh AI + stock video) trong 1 lần gọi duy nhất. Tự tách nội bộ: ảnh AI (8 song song) + stock video (10 song song) + 2 nhóm chạy đồng thời với nhau. KHÔNG còn gọi batch_acquire_images hay batch_search_stock riêng — gộp TOÀN BỘ vào đây.',
    parameters: {
      type: 'OBJECT',
      properties: {
        segments: {
          type: 'ARRAY',
          description: 'TẤT CẢ phân cảnh cần visual (cả ảnh AI lẫn stock video). broll_media="image"→Imagen AI; broll_media="video"→Pexels/Pixabay stock.',
          items: {
            type: 'OBJECT',
            properties: {
              segment_id:  { type: 'NUMBER' },
              query:       { type: 'STRING', description: 'Mô tả cảnh (tiếng Anh). image: concept/object (NO người). video: hành động cụ thể.' },
              broll_media: { type: 'STRING', enum: ['image','video'], description: 'image=ảnh AI Imagen; video=stock Pexels/Pixabay. BẮT BUỘC điền.' },
              duration_sec:{ type: 'NUMBER' },
              provider:    { type: 'STRING', enum: ['pexels','pixabay','both','dvids'], description: 'Chỉ cho video. "dvids"=footage quân sự Mỹ mới nhất (tập trận, vũ khí, máy bay, tàu chiến); còn lại default "both"' },
            },
            required: ['segment_id','query','broll_media'],
          },
        },
      },
      required: ['segments'],
    },
  },

  {
    name: 'create_character_reference',
    description: 'Tạo ảnh reference nhân vật chính để nhất quán xuyên suốt video. GỌI khi video CÓ nhân vật xuyên suốt (story, drama, vlog, tutorial có người dẫn). KHÔNG GỌI khi video là concept/explainer/tài chính/fact (không có nhân vật cụ thể). Gọi sau set_platform_config, TRƯỚC batch_acquire_all.',
    parameters: {
      type: 'OBJECT',
      properties: {
        character_description: {
          type: 'STRING',
          description: 'Mô tả chi tiết nhân vật (tiếng Anh): gender, age, ethnicity, hair, skin tone, clothing. VD: "Vietnamese woman, 28, long black hair, warm brown skin, casual white blouse"',
        },
      },
      required: ['character_description'],
    },
  },

  {
    name: 'batch_generate_tts',
    description: '⭐⭐ CÔNG CỤ TTS CHÍNH — Tổng hợp giọng đọc cho TẤT CẢ phân cảnh trong 1 lần gọi. 4 luồng song song nội bộ. Gộp TOÀN BỘ cảnh có narration vào đây thay vì gọi generate_tts từng cái.',
    parameters: {
      type: 'OBJECT',
      properties: {
        segments: {
          type: 'ARRAY',
          description: 'TẤT CẢ phân cảnh có narration.',
          items: {
            type: 'OBJECT',
            properties: {
              segment_id: { type: 'NUMBER' },
              text:        { type: 'STRING', description: 'Nội dung narration' },
              speed:       { type: 'NUMBER', description: '0.7–1.4, default 1.0' },
              emotion:     { type: 'STRING', enum: ['calm','excited','serious','dramatic','gentle','energetic'] },
            },
            required: ['segment_id','text'],
          },
        },
      },
      required: ['segments'],
    },
  },

  {
    name: 'generate_tts',
    description: 'Tạo file audio TTS từ đoạn narration của một phân cảnh. CHỈ dùng khi retry 1 cảnh cụ thể thất bại sau batch_generate_tts. Bình thường dùng batch_generate_tts.',
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
    name: 'fix_render_error',
    description: 'Tự động chẩn đoán và sửa lỗi render: kiểm tra file tồn tại, xóa asset hỏng khỏi edit-plan, patch bgMusic path. Gọi NGAY sau khi render_video thất bại TRƯỚC KHI retry hoặc re-acquire asset.',
    parameters: {
      type: 'OBJECT',
      properties: {
        error_text: { type: 'STRING', description: 'Nội dung lỗi nhận được từ render_video (copy nguyên văn)' },
      },
      required: [],
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
        provider:    { type: 'STRING', enum: ['pexels','pixabay','both','dvids'], description: 'Nguồn stock video, default "both". "dvids"=footage quân sự Mỹ mới nhất' },
      },
      required: ['segment_id','query'],
    },
  },

  {
    name: 'add_background_music',
    description: 'Thêm nhạc nền BGM vào video. Hệ thống tự tìm nhạc thật (Pixabay/Jamendo) hoặc tổng hợp BGM từ thư viện nội bộ (không cần internet). Gọi TRƯỚC render_video. Quan trọng cho engagement YouTube/TikTok.',
    parameters: {
      type: 'OBJECT',
      properties: {
        mood:    { type: 'STRING', enum: ['upbeat','dramatic','calm','inspiring','mysterious','cinematic','emotional','corporate','epic','lofi'], description: 'Tone nhạc: epic/cinematic=hùng tráng; dramatic=kịch tính; lofi/calm=thư giãn; upbeat=năng lượng; corporate/mysterious=synthwave tech' },
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
    description: 'Kiểm tra chất lượng TRƯỚC khi render. CHỈ gọi sau khi ĐÃ generate_tts cho ít nhất 80% cảnh có narration — KHÔNG gọi trước khi TTS xong. Đánh giá: TTS coverage, asset coverage, visual diversity, audio, pacing. Nếu score ≥ 6.5 VÀ TTS ≥ 80% → gọi render_video. Nếu thiếu TTS → generate_tts thêm rồi gọi lại. Nếu lỗi visual → fix rồi gọi lại quality_check.',
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
        title:              { type: 'STRING', description: 'Chữ hook trên thumbnail: 2–6 từ, gây tò mò. KHÔNG dùng nguyên tiêu đề SEO dài. Dùng thumbnail_text do generate_seo trả về nếu có.' },
        highlight:          { type: 'STRING', description: 'Con số/thông số ấn tượng màu accent (vd "3 GIÂY", "240 KM/H", "90%"). TUYỆT ĐỐI KHÔNG lặp lại từ đã có trong title. Không có số phù hợp → để trống.' },
        badge:              { type: 'STRING', description: 'Nhãn chủ đề 1–2 từ (vd "🎖️ QUÂN SỰ", "⚔️ SO SÁNH", "🔥 TOP 5"). KHÔNG lặp từ trong title/highlight. Tùy chọn.' },
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

// extend_plan dùng chung schema cảnh với plan_video (TOOL_DECLARATIONS[0])
TOOL_DECLARATIONS.splice(1, 0, {
  name: 'extend_plan',
  description: 'Viết TIẾP kế hoạch cho video dài: thêm 15–20 cảnh nối tiếp vào cuối plan hiện có. Gọi khi plan_video / extend_plan trả plan_incomplete=true. Nối mạch từ last_narration, đi theo outline. Đợt cuối: is_final_part=true và cảnh cuối là CTA (visual_type=text). id cảnh sẽ được hệ thống đánh lại nối tiếp.',
  parameters: {
    type: 'OBJECT',
    properties: {
      segments: TOOL_DECLARATIONS[0].parameters.properties.segments,
      is_final_part: { type: 'BOOLEAN', description: 'true nếu đây là đợt cuối (có cảnh CTA kết thúc video)' },
    },
    required: ['segments'],
  },
});

// ── Chuẩn hóa cảnh sau plan_video / extend_plan: đa dạng visual, transition, brollMode, humanize, visual prompt ──
const LAZY_TYPES = new Set(['text', 'graphic', 'motion_graphic']);
async function normalizePlanSegments(segs, { brollMode, apiKeys, model, lang = 'vi', title = '', isStart = true, isEnd = true }) {
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

  // ── Enforce transition diversity: prevent all-fade / all-cut monotony ──
  {
    const ALL_TRANS = ['fade','slide_left','slide_right','slide_up','slide_down','zoom_in','zoom_out','cut','whip','glitch','blur'];
    // Palette theo content type:
    // hook (cảnh 0): zoom_in hoặc glitch để gây chú ý
    // CTA (cảnh cuối): fade hoặc zoom_out
    // middle: xoay vòng đa dạng, tránh repeat 2 cảnh liên tiếp cùng loại
    const midPalette = ['slide_left','slide_up','zoom_in','cut','whip','slide_right','blur','slide_down','zoom_out','fade'];
    const allSame = segs.length > 3 && segs.every(s => (s.transition_type || 'fade') === (segs[0].transition_type || 'fade'));
    const tooManyFade = segs.filter(s => (s.transition_type || 'fade') === 'fade').length > segs.length * 0.5;
    if (allSame || tooManyFade) {
      segs.forEach((seg, i) => {
        if (i === 0 && isStart) {
          seg.transition_type = 'zoom_in';
        } else if (i === segs.length - 1 && isEnd) {
          seg.transition_type = 'fade';
        } else {
          // Xoay vòng palette, tránh trùng cảnh trước
          let t = midPalette[i % midPalette.length];
          const prev = segs[i - 1]?.transition_type;
          if (t === prev) t = midPalette[(i + 1) % midPalette.length];
          seg.transition_type = t;
        }
      });
    } else {
      // Chỉ fix những cảnh chưa có transition_type
      segs.forEach((seg, i) => {
        if (!seg.transition_type) {
          if (i === 0 && isStart) seg.transition_type = 'zoom_in';
          else if (i === segs.length - 1 && isEnd) seg.transition_type = 'fade';
          else {
            let t = midPalette[i % midPalette.length];
            if (t === segs[i - 1]?.transition_type) t = midPalette[(i + 2) % midPalette.length];
            seg.transition_type = t;
          }
        }
      });
    }
  }

  // ── Respect brollMode setting: remap visual types to match user's choice ──
  if (brollMode === 'image') {
    for (const seg of segs) {
      if (['broll','ai_video','ai_image'].includes(seg.visual_type)) {
        seg.visual_type = 'broll';
        seg.broll_media = 'image'; // Imagen AI photo
        if (!seg.visual_prompt) seg.visual_prompt = seg.narration?.slice(0, 120) || 'visual scene';
        if (!seg.broll_query) seg.broll_query = seg.visual_prompt || seg.narration?.slice(0, 80) || 'cinematic scene';
      }
    }
  } else if (brollMode === 'stock') {
    for (const seg of segs) {
      if (['broll','ai_video','ai_image'].includes(seg.visual_type)) {
        seg.visual_type = 'broll';
        seg.broll_media = 'video'; // Pexels/Pixabay stock
        if (!seg.broll_query) seg.broll_query = seg.visual_prompt || seg.narration?.slice(0, 60) || 'relevant footage';
      }
    }
  }

  // ── Auto mode: ai_image→Imagen, broll/ai_video→stock ──
  let autoRemapped = 0;
  if (brollMode === 'auto') {
    for (const seg of segs) {
      if (seg.visual_type === 'ai_image' && !seg.broll_media) {
        seg.visual_type = 'broll';
        seg.broll_media = 'image'; // Imagen AI photo
        if (!seg.broll_query && seg.visual_prompt) seg.broll_query = seg.visual_prompt.slice(0, 150);
        autoRemapped++;
      } else if ((seg.visual_type === 'ai_video' || seg.visual_type === 'broll') && !seg.broll_media) {
        seg.visual_type = 'broll';
        seg.broll_media = 'video'; // Pexels/Pixabay stock
        if (!seg.broll_query && seg.visual_prompt) seg.broll_query = seg.visual_prompt.slice(0, 150);
        autoRemapped++;
      } else if (seg.visual_type === 'broll' && !seg.broll_media) {
        seg.broll_media = 'video'; // Pexels/Pixabay stock
        autoRemapped++;
      }
    }
  }

  // ── Humanize all narrations (batch, user-selected model) ──
  try {
    const humanized = await humanizeNarrations(segs, apiKeys, model, lang);
    humanized.forEach((h, i) => { if (segs[i]) segs[i].narration = h.narration; });
  } catch (_) {}

  // ── Auto-generate visual prompts that ILLUSTRATE narration (not generic) ──
  try {
    const improved = await improveVisualPrompts(segs, apiKeys, model, title);
    improved.forEach((seg, i) => {
      if (segs[i] && seg.visual_prompt) {
        segs[i].visual_prompt = seg.visual_prompt;
        segs[i].broll_query   = seg.broll_query || seg.visual_prompt;
      }
    });
  } catch (_) {}

  return { converted, autoRemapped };
}

const planSeconds = (segs) => segs.reduce((sum, sg) => sum + (Number(sg.duration_sec) || 6), 0);

// Plan video dài chưa đủ thời lượng → yêu cầu viết tiếp theo dàn ý, giữ mạch từ cảnh cuối
function planIncompleteResult(projectState) {
  const segs = projectState.plan.segments;
  const { targetSec, avgSecPerScene } = projectState.planPending;
  const soFar = Math.round(planSeconds(segs));
  const remainingScenes = Math.max(1, Math.ceil((targetSec - soFar) / avgSecPerScene));
  const batch = Math.min(20, remainingScenes);
  const last = segs[segs.length - 1];
  const outline = Array.isArray(projectState.plan.outline) ? projectState.plan.outline : [];
  const partIdx = Math.min(outline.length - 1, Math.floor((soFar / targetSec) * outline.length));
  const outlineHint = outline.length
    ? ` Đang ở phần ${partIdx + 1}/${outline.length}: "${outline[partIdx]}". Các phần còn lại: ${outline.slice(partIdx + 1).join(' → ') || '(phần kết)'}.`
    : '';
  return {
    success: true,
    plan_incomplete: true,
    scenes_so_far: segs.length,
    seconds_so_far: soFar,
    target_sec: targetSec,
    next_scene_id: (Number(last?.id) || segs.length) + 1,
    last_narration: String(last?.narration || '').slice(0, 200),
    instruction: `📋 Đã lưu ${segs.length} cảnh (~${soFar}s / ${targetSec}s). CHƯA ĐỦ THỜI LƯỢNG — gọi extend_plan với ${batch} cảnh TIẾP THEO (mỗi cảnh ~${avgSecPerScene}s, narration ~${Math.round(avgSecPerScene * 2.25)} từ), nối mạch từ câu cuối: "${String(last?.narration || '').slice(0, 120)}".${outlineHint} Còn ~${remainingScenes} cảnh.${remainingScenes <= 20 ? ' Đây là đợt CUỐI: đặt is_final_part=true, cảnh cuối là CTA (visual_type=text).' : ''} KHÔNG gọi batch_acquire_all / batch_generate_tts trước khi kế hoạch đủ thời lượng.`,
  };
}

function planReadyResult(segs, brollMode, { converted = 0, autoRemapped = 0 } = {}) {
  const total = segs.length;
  const lazyTotal = segs.filter(s => LAZY_TYPES.has(s.visual_type)).length;
  const modeLabel = brollMode === 'image' ? 'Imagen AI photo' : brollMode === 'stock' ? 'stock video' : 'auto mix';
  const autoHint = brollMode === 'auto' && autoRemapped > 0
    ? ` AUTO: ai_image→broll_media:image (Imagen), broll/ai_video→broll_media:video (stock). Dùng broll_media trong must_acquire. KHÔNG gọi generate_image.`
    : '';
  return {
    success: true,
    message: `Plan hoàn chỉnh: ${total} cảnh (~${Math.round(planSeconds(segs))}s). ${total - lazyTotal} cần visual (${modeLabel}), ${lazyTotal} text/graphic.${converted > 0 ? ` Auto-converted ${converted} lazy scenes.` : ''}${autoHint} NOW acquire assets for ALL broll/ai_image scenes.`,
    segments: total,
    must_acquire: segs.filter(s => ['broll','ai_image','illustration'].includes(s.visual_type))
      .map(s => ({ id: s.id, visual_type: s.visual_type, broll_media: s.broll_media || null })),
  };
}

// Ghi kịch bản ra thư mục output sau mỗi đợt lập kế hoạch: .txt để đọc/sửa, .json để nạp lại
async function saveScriptFile(projectState, outputDir) {
  const api = window.electronAPI;
  const plan = projectState.plan;
  if (!outputDir || !plan?.segments?.length || !api?.writeTextFile) return null;
  const safe = String(plan.title || 'video').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'video';
  const base = `${outputDir}\\kich_ban_${safe}`;
  const fmt = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
  const total = planSeconds(plan.segments);
  const pending = projectState.planPending;
  const lines = [
    `TIÊU ĐỀ: ${plan.title || ''}`,
    `THỜI LƯỢNG: ~${fmt(total)} / mục tiêu ${fmt(plan.total_duration_sec || total)} — ${plan.segments.length} cảnh — ${pending ? 'ĐANG VIẾT TIẾP' : 'HOÀN CHỈNH'}`,
    ...(plan.description ? [`MÔ TẢ: ${plan.description}`] : []),
    ...(Array.isArray(plan.outline) && plan.outline.length ? ['', 'DÀN Ý:', ...plan.outline.map((o, i) => `  ${i + 1}. ${o}`)] : []),
    '', '━'.repeat(60),
  ];
  let t = 0;
  for (const sg of plan.segments) {
    const d = Number(sg.duration_sec) || 6;
    lines.push('', `[Cảnh ${sg.id}] ${fmt(t)} · ${d}s · ${sg.visual_type}${sg.broll_media ? `/${sg.broll_media}` : ''}${sg.transition_type ? ` · ${sg.transition_type}` : ''}`);
    lines.push(`Lời thoại: ${sg.narration || ''}`);
    const vis = sg.broll_query || sg.visual_prompt || sg.text_heading || (sg.graphic_data ? JSON.stringify(sg.graphic_data) : '');
    if (vis) lines.push(`Hình ảnh: ${vis}`);
    t += d;
  }
  try {
    await api.writeTextFile({ filePath: `${base}.txt`, content: lines.join('\n') });
    await api.writeTextFile({ filePath: `${base}.json`, content: JSON.stringify({ ...plan, planPending: pending || null }, null, 2) });
    return `${base}.txt`;
  } catch (_) { return null; }
}

// Kế hoạch video dài đang viết dở → chặn sản xuất để AI không làm video thiếu cảnh
const BLOCKED_WHILE_PLANNING = new Set(['batch_acquire_all', 'batch_generate_tts', 'batch_acquire_images', 'batch_search_stock', 'quality_check', 'render_video']);

// ── Build Remotion edit-plan.json from accumulated project state ──────────────
export function buildEditPlan(plan, assets) {
  const fps = 30;
  let currentFrame = 0;

  const segments = (plan.segments || []).map(seg => {
    const asset = assets[seg.id] || {};
    // If we have real TTS duration, use it directly (+ 0.3s breathing room).
    // Do NOT clamp to seg.duration_sec — that's the AI's estimate (usually 5s) and causes
    // 1.5-2.5s of dead silence when TTS is only 2-3s long.
    const durationSec = asset.ttsDuration
      ? asset.ttsDuration + 0.3
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
        ? { type: 'broll', file: asset.brollFile, duration: asset.brollDuration, startSec: asset.brollStartSec || 0, zoom: 1.08, brightness: 0.82, motion: seg.visual_motion || 'slow_zoom' }
        : { type: 'ai_image', file: asset.imagePath, motion: seg.visual_motion || 'ken_burns', zoom: 1.07 };
    } else {
      switch (seg.visual_type) {
        case 'broll':
          if (asset.brollFile) {
            visual = { type: 'broll', file: asset.brollFile, duration: asset.brollDuration, startSec: asset.brollStartSec || 0, zoom: 1.08, brightness: 0.82, motion: seg.visual_motion || 'slow_zoom' };
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
            ? { type: 'broll', file: asset.brollFile, duration: asset.brollDuration, startSec: asset.brollStartSec || 0, zoom: 1.05, brightness: 0.88, motion: seg.visual_motion || 'slow_zoom' }
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
        case 'graphic': {
          const gd = seg.graphic_data;
          const tmpl = seg.graphic_template || 'default';
          // Downgrade template khi thiếu data — tránh render rỗng
          const hasStatData = gd?.values?.length > 0;
          const hasBarData  = gd?.items?.length > 0;
          const hasFlowData = gd?.steps?.length > 0;
          const effectiveTmpl = (
            (tmpl === 'stat_card'       && !hasStatData) ||
            (tmpl === 'percentage_bar'  && !hasBarData)  ||
            (tmpl === 'timeline_flow'   && !hasFlowData)
          ) ? 'default' : tmpl;
          visual = {
            type: 'graphic',
            template: effectiveTmpl,
            data: gd || {
              heading: seg.text_heading || '',
              subtext: seg.narration || '',
              icon: seg.visual_icon || '📊',
            },
            ...(seg.visual_accent ? { accent: seg.visual_accent } : {}),
          };
          break;
        }
        case 'chart':
          visual = {
            type: 'graphic',
            template: (seg.graphic_data?.items?.length > 0) ? 'percentage_bar' : 'default',
            data: seg.graphic_data || { heading: seg.text_heading || '', subtext: seg.narration || '', icon: '📊' },
            ...(seg.visual_accent ? { accent: seg.visual_accent } : {}),
          };
          break;
        case 'motion_graphic':
          visual = {
            type: 'graphic',
            template: (seg.graphic_data?.values?.length > 0) ? (seg.graphic_template || 'stat_card') : 'default',
            data: seg.graphic_data || { heading: seg.text_heading || '', subtext: seg.narration || '', icon: '📈' },
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
            ? { type: 'broll', file: asset.brollFile, startSec: asset.brollStartSec || 0, zoom: 1.08, brightness: 0.85 }
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
export async function executeTool(toolName, args, { apiKeys, model = 'gemini-3.5-flash', voice, ttsProvider = 'edge', brollMode = 'image', outputDir, vieNeuSavedVoices = [], projectState, refImagePaths = [], onAsset = null, manualSfxList = [] }) {
  const api = window.electronAPI;
  const segId = args.segment_id ?? 0;

  if (projectState?.planPending && BLOCKED_WHILE_PLANNING.has(toolName)) {
    return { ...planIncompleteResult(projectState), success: false, error: 'plan_incomplete' };
  }

  switch (toolName) {

    case 'plan_video': {
      if (!projectState.assetRegistry) projectState.assetRegistry = {};

      // ── Anti-lazy: enforce requested duration ──
      // Video ngắn: bắt viết lại (tối đa 2 lần). Video dài (≥3 phút): model không viết nổi 50–100 cảnh
      // trong 1 lần gọi → nhận plan từng phần, yêu cầu viết tiếp bằng extend_plan.
      const requestedSec = Number(projectState.requestedDuration) || 0;
      let pendingInfo = null;
      {
        const segsRaw = args.segments || [];
        const aiDeclaredSec = Number(args.total_duration_sec) || 0;
        const targetSec = requestedSec > 0 ? requestedSec : aiDeclaredSec;

        if (targetSec > 30 && segsRaw.length > 0) {
          const actualSumSec = segsRaw.reduce((s, sg) => s + (Number(sg.duration_sec) || 8), 0);
          const avgSecPerScene = targetSec > 600 ? 8 : targetSec > 300 ? 6 : 5;
          const minScenes = Math.round(targetSec / avgSecPerScene);
          const coverageRatio = actualSumSec / targetSec;
          const durationMismatch = requestedSec > 0 && aiDeclaredSec > 0 && Math.abs(aiDeclaredSec - requestedSec) / requestedSec > 0.2;

          if (!projectState.planRetries) projectState.planRetries = 0;
          const tooFewScenes = segsRaw.length < Math.max(4, Math.round(minScenes * 0.65));
          const insufficientCoverage = coverageRatio < 0.55;

          if (targetSec >= 180 && (tooFewScenes || insufficientCoverage)) {
            pendingInfo = { targetSec, avgSecPerScene, extendCalls: 0 };
          } else if (projectState.planRetries < 2 && (tooFewScenes || insufficientCoverage || durationMismatch)) {
            projectState.planRetries++;
            const issues = [];
            if (durationMismatch) issues.push(`total_duration_sec=${aiDeclaredSec} nhưng người dùng yêu cầu ${requestedSec}s — PHẢI đặt total_duration_sec=${requestedSec}`);
            if (tooFewScenes) issues.push(`chỉ ${segsRaw.length} cảnh, cần ≥ ${Math.round(minScenes * 0.8)} cảnh`);
            if (insufficientCoverage) issues.push(`tổng cảnh chỉ ${Math.round(actualSumSec)}s / ${targetSec}s yêu cầu (${Math.round(coverageRatio*100)}%)`);
            return {
              result: `⚠️ VIDEO CHƯA ĐỦ THỜI LƯỢNG: ${issues.join(' | ')}.

Gọi lại plan_video với:
• total_duration_sec = ${requestedSec || targetSec} (BẮT BUỘC, không được đặt thấp hơn)
• Ít nhất ${Math.round(minScenes * 0.85)} cảnh (~${avgSecPerScene}s/cảnh)
• Narration mỗi cảnh ~${Math.round(avgSecPerScene * 2.25)} từ (đủ để TTS đọc hết ${avgSecPerScene}s)
• Phân bổ nội dung đều từ đầu đến cuối, KHÔNG cắt bớt`,
              success: false,
            };
          }
        }
      }
      if (requestedSec > 0) args.total_duration_sec = requestedSec;

      projectState.plan = args;
      projectState.planPending = pendingInfo;
      // Remotion đọc project.preset để chọn bảng màu quân sự cho graphic/text
      if (projectState.preset === 'military') args.preset = 'military';
      // Save character description for injection into all subsequent prompts
      if (args.character_description) {
        projectState.characterDescription = args.character_description;
      }

      const segs = args.segments || [];
      const { converted, autoRemapped } = await normalizePlanSegments(segs, { brollMode, apiKeys, model, lang: args.lang || 'vi', title: args.title || '', isStart: true, isEnd: !pendingInfo });

      const out = pendingInfo ? planIncompleteResult(projectState) : planReadyResult(segs, brollMode, { converted, autoRemapped });
      out.script_file = await saveScriptFile(projectState, outputDir);
      return out;
    }

    case 'extend_plan': {
      if (!projectState.plan?.segments?.length) return { success: false, error: 'Chưa có plan — gọi plan_video trước' };
      const newSegs = (args.segments || []).filter(sg => sg && sg.narration);
      if (!newSegs.length) return { success: false, error: 'extend_plan cần ít nhất 1 cảnh có narration' };

      const all = projectState.plan.segments;
      // Đánh lại id nối tiếp — AI hay đặt id trùng với cảnh cũ
      let nextId = Math.max(0, ...all.map(sg => Number(sg.id) || 0)) + 1;
      for (const sg of newSegs) { sg.id = nextId++; if (!sg.duration_sec) sg.duration_sec = 6; }
      all.push(...newSegs);

      const pending = projectState.planPending;
      if (pending) pending.extendCalls = (pending.extendCalls || 0) + 1;
      const done = !pending || planSeconds(all) >= pending.targetSec * 0.95 || args.is_final_part || pending.extendCalls >= 20;

      const { converted, autoRemapped } = await normalizePlanSegments(newSegs, { brollMode, apiKeys, model, lang: projectState.plan.lang || 'vi', title: projectState.plan.title || '', isStart: false, isEnd: done });

      if (done) projectState.planPending = null;
      const out = done ? planReadyResult(all, brollMode, { converted, autoRemapped }) : planIncompleteResult(projectState);
      out.script_file = await saveScriptFile(projectState, outputDir);
      return out;
    }

    case 'acquire_broll': {
      // Determine effective mode: also check stored plan's broll_media in case AI forgot to pass it
      const planSeg = (projectState.plan?.segments || []).find(s => Number(s.id) === Number(segId));
      const plannedMedia = args.broll_media || planSeg?.broll_media || null;
      // _forceImage: stock đã hết đoạn chưa chiếu → chỉ còn cách tạo ảnh, không tìm stock lại
      const effectiveMode = args._forceImage ? 'image'
        : brollMode === 'auto'
        ? (plannedMedia === 'video' ? 'video' : 'image')  // use plan's decision, not just AI's arg
        : brollMode === 'stock' ? 'video'
        : 'image';

      // Video stock luôn đi qua search_stock_footage — nơi duy nhất theo dõi đoạn clip đã chiếu để không lặp
      if (effectiveMode === 'video') {
        return executeTool('search_stock_footage',
          { segment_id: segId, query: args.query || planSeg?.broll_query || '', duration_sec: args.duration_sec || planSeg?.duration_sec || 6 },
          { apiKeys, model, voice, ttsProvider, brollMode, outputDir, vieNeuSavedVoices, projectState, refImagePaths, onAsset, manualSfxList });
      }

      // ── Character consistency: build effective reference image list ─────────────
      const hasCanonical = !!projectState.canonicalCharacterImage;
      let effectiveRefImages = refImagePaths.length > 0
        ? [...refImagePaths]
        : (hasCanonical ? [projectState.canonicalCharacterImage] : []);

      // Build query: use AI's query + enrich with narration content for better image-voice match
      const hasCharRef = refImagePaths.length > 0 || hasCanonical;
      const narrationHint = planSeg?.narration
        ? (() => {
            // Extract key nouns from Vietnamese narration (words > 4 chars, skip stopwords)
            const stopwords = new Set(['được','những','trong','ngoài','nhưng','hoặc','chúng','chính','không','người','thêm','nhiều','giữa','trước','sau','bằng','với','cho','các','này','đây','khi','vẫn','đến','từ','của','là','và','có','một','họ','tôi','anh','chị','đó']);
            const words = planSeg.narration.split(/\s+/).filter(w => w.length > 4 && !stopwords.has(w.toLowerCase())).slice(0, 5);
            return words.length > 0 ? ` (context: ${words.join(' ')})` : '';
          })()
        : '';
      let brollQuery = (args.query || planSeg?.broll_query || planSeg?.visual_prompt || 'cinematic scene').slice(0, 200) + narrationHint;
      if (hasCharRef && projectState.characterDescription) {
        brollQuery = `${brollQuery}, featuring: ${projectState.characterDescription} — same character, consistent appearance`;
      } else if (hasCharRef) {
        brollQuery = `${brollQuery} — same character as reference, consistent appearance throughout video`;
      }

      const result = await api.agentAcquireBroll({
        query: brollQuery,
        segmentId: segId,
        durationSec: args.duration_sec || 6,
        mode: effectiveMode,
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

      // Log lỗi thật để user thấy trên tab Log
      if (result?.error) {
        onAsset?.({ type: 'log', label: `⚠️ Scene ${segId} AI image: ${result.error}` });
      }

      // Ảnh AI thất bại (lỗi Flow / hết quota / bộ lọc an toàn). Không dùng illustration PNG cũ nữa:
      // nó tốn thêm 1 lần gọi Gemini + 20-40s render mà hầu như chỉ ra nền trống.
      // 1) Kênh quân sự: thử footage DVIDS theo tên vũ khí đầu câu mô tả ảnh
      if (effectiveMode === 'image' && projectState.preset === 'military') {
        const stockQuery = String(args.query || planSeg?.broll_query || '').split(/[,.(]/)[0].split(/\s+/).slice(0, 3).join(' ').trim();
        if (stockQuery) {
          const st = await executeTool('search_stock_footage',
            { segment_id: segId, query: stockQuery, duration_sec: args.duration_sec || 6, provider: 'dvids', _noFallback: true },
            { apiKeys, model, voice, ttsProvider, brollMode, outputDir, vieNeuSavedVoices, projectState, refImagePaths, onAsset, manualSfxList });
          if (st?.success) return { ...st, fallback_level: 1 };
        }
      }
      // 2) Đổi cảnh thành thẻ dữ kiện (FactCard) vẽ từ lời thoại lúc render — không cần gọi thêm AI
      if (planSeg) {
        planSeg.visual_type = 'graphic';
        planSeg.graphic_template = 'default';
        planSeg.graphic_data = { subtext: planSeg.narration || args.query || '' };
        onAsset?.({ type: 'log', label: `🧩 Scene ${segId}: ảnh AI lỗi → chuyển thành thẻ dữ kiện từ lời thoại` });
        return { success: true, type: 'graphic', fallback_level: 2, message: 'AI image failed → scene converted to fact-card graphic (no retry needed)' };
      }

      return { success: false, message: result?.error || 'B-roll không khả dụng' };
    }

    case 'batch_acquire_images': {
      const segsToProcess = (args.segments || []).filter(s => s.segment_id != null && s.query);
      if (segsToProcess.length === 0) return { success: false, error: 'Không có segment nào để xử lý' };

      // VeoEngine._withFlowExtMutex serializes Extension calls tự động — 8 luồng IPC gửi cùng lúc,
      // Extension xử lý tuần tự qua mutex, không cần sequential ở đây nữa.
      const CHUNK = 8;
      const results = [];
      for (let i = 0; i < segsToProcess.length; i += CHUNK) {
        const chunk = segsToProcess.slice(i, i + CHUNK);
        const chunkResults = await Promise.all(chunk.map(s =>
          executeTool('acquire_broll', {
            segment_id: s.segment_id,
            query: s.query,
            duration_sec: s.duration_sec || 6,
            broll_media: 'image',
          }, { apiKeys, voice, ttsProvider, brollMode, outputDir, vieNeuSavedVoices, projectState, refImagePaths, onAsset })
          .then(r => ({ segId: s.segment_id, ...r }))
          .catch(e => ({ segId: s.segment_id, success: false, error: e.message }))
        ));
        results.push(...chunkResults);
      }
      const done = results.filter(r => r.success).length;
      const failed = results.length - done;
      return {
        success: done > 0,
        message: `Batch ${segsToProcess.length} ảnh: ✓ ${done} xong${failed > 0 ? `, ✗ ${failed} thất bại` : ''}`,
        results,
      };
    }

    case 'batch_search_stock': {
      const segsToProcess = (args.segments || []).filter(s => s.segment_id != null && s.query);
      if (segsToProcess.length === 0) return { success: false, error: 'Không có segment nào để xử lý' };

      // 8-10 tác vụ tìm + tải song song — HTTP requests độc lập, không cần serialize
      const CHUNK = 10;
      const results = [];
      for (let i = 0; i < segsToProcess.length; i += CHUNK) {
        const chunk = segsToProcess.slice(i, i + CHUNK);
        const chunkResults = await Promise.all(chunk.map(s =>
          executeTool('search_stock_footage', {
            segment_id: s.segment_id,
            query: s.query,
            duration_sec: s.duration_sec || 6,
            provider: s.provider,
          }, { apiKeys, voice, ttsProvider, brollMode, outputDir, vieNeuSavedVoices, projectState, refImagePaths, onAsset, manualSfxList })
          .then(r => ({ segId: s.segment_id, ...r }))
          .catch(e => ({ segId: s.segment_id, success: false, error: e.message }))
        ));
        results.push(...chunkResults);
      }
      const done = results.filter(r => r.success).length;
      const failed = results.length - done;
      return {
        success: done > 0,
        message: `Batch ${segsToProcess.length} stock video: ✓ ${done} xong${failed > 0 ? `, ✗ ${failed} thất bại` : ''}`,
        results,
      };
    }

    case 'batch_acquire_all': {
      const segsToProcess = (args.segments || []).filter(s => s.segment_id != null && s.query && s.broll_media);
      if (segsToProcess.length === 0) return { success: false, error: 'Không có segment nào để xử lý' };

      const imageSegs = segsToProcess.filter(s => s.broll_media === 'image');
      const videoSegs  = segsToProcess.filter(s => s.broll_media === 'video');

      // Both groups run concurrently — image 8-parallel, video 10-parallel
      const [imageResults, videoResults] = await Promise.all([
        (async () => {
          if (imageSegs.length === 0) return [];
          const CHUNK = 8;
          const out = [];
          for (let i = 0; i < imageSegs.length; i += CHUNK) {
            const chunk = imageSegs.slice(i, i + CHUNK);
            const chunkRes = await Promise.all(chunk.map(s =>
              executeTool('acquire_broll', { segment_id: s.segment_id, query: s.query, duration_sec: s.duration_sec || 6, broll_media: 'image' },
                { apiKeys, voice, ttsProvider, brollMode, outputDir, vieNeuSavedVoices, projectState, refImagePaths, onAsset })
              .then(r => ({ segId: s.segment_id, ...r }))
              .catch(e => ({ segId: s.segment_id, success: false, error: e.message }))
            ));
            out.push(...chunkRes);
          }
          return out;
        })(),
        (async () => {
          if (videoSegs.length === 0) return [];
          const CHUNK = 10;
          const out = [];
          for (let i = 0; i < videoSegs.length; i += CHUNK) {
            const chunk = videoSegs.slice(i, i + CHUNK);
            const chunkRes = await Promise.all(chunk.map(s =>
              executeTool('search_stock_footage', { segment_id: s.segment_id, query: s.query, duration_sec: s.duration_sec || 6, provider: s.provider },
                { apiKeys, voice, ttsProvider, brollMode, outputDir, vieNeuSavedVoices, projectState, refImagePaths, onAsset, manualSfxList })
              .then(r => ({ segId: s.segment_id, ...r }))
              .catch(e => ({ segId: s.segment_id, success: false, error: e.message }))
            ));
            out.push(...chunkRes);
          }
          return out;
        })(),
      ]);

      const allResults = [...imageResults, ...videoResults];
      const imgDone = imageResults.filter(r => r.success).length;
      const vidDone = videoResults.filter(r => r.success).length;
      const totalDone = imgDone + vidDone;
      const totalFail = allResults.length - totalDone;
      return {
        success: totalDone > 0,
        message: `Batch all visual: 🖼 ${imgDone}/${imageSegs.length} ảnh AI + 📹 ${vidDone}/${videoSegs.length} stock. ✓ ${totalDone}${totalFail > 0 ? ` ✗ ${totalFail}` : ''}`,
        results: allResults,
      };
    }

    case 'batch_generate_tts': {
      const segsToProcess = (args.segments || []).filter(s => s.segment_id != null && s.text?.trim());
      if (segsToProcess.length === 0) return { success: false, error: 'Không có segment nào để TTS' };

      // 4 luồng song song — TTS rate-limited nên không cần nhiều hơn
      const CHUNK = 4;
      const results = [];
      for (let i = 0; i < segsToProcess.length; i += CHUNK) {
        const chunk = segsToProcess.slice(i, i + CHUNK);
        const chunkRes = await Promise.all(chunk.map(s =>
          executeTool('generate_tts', {
            segment_id: s.segment_id,
            text: s.text,
            speed: s.speed,
            emotion: s.emotion,
          }, { apiKeys, voice, ttsProvider, brollMode, outputDir, vieNeuSavedVoices, projectState, refImagePaths, onAsset, manualSfxList })
          .then(r => ({ segId: s.segment_id, ...r }))
          .catch(e => ({ segId: s.segment_id, success: false, error: e.message }))
        ));
        results.push(...chunkRes);
      }
      const done = results.filter(r => r.success).length;
      const failed = results.length - done;
      return {
        success: done > 0,
        message: `Batch TTS ${segsToProcess.length} cảnh: ✓ ${done}${failed > 0 ? ` ✗ ${failed}` : ''}`,
        results,
      };
    }

    case 'create_character_reference': {
      if (!args.character_description) return { success: false, error: 'character_description is required' };

      if (projectState.canonicalCharacterImage) {
        return { success: true, message: `Reference đã có sẵn`, path: projectState.canonicalCharacterImage, already_exists: true };
      }

      projectState.characterDescription = args.character_description;

      try {
        const portraitPrompt = `portrait photo of ${args.character_description}, professional studio photography, face clearly visible, neutral background, high quality, cinematic lighting, photorealistic`;
        onAsset?.({ type: 'image', segId: 9998, label: '🎭 Đang tạo ảnh reference nhân vật chính...' });
        const portraitResult = await api.agentAcquireBroll({
          query: portraitPrompt,
          segmentId: 9998,
          durationSec: 5,
          mode: 'image',
          refImagePaths: refImagePaths.length > 0 ? refImagePaths : [],
        });
        if (portraitResult?.success && portraitResult.absolutePath) {
          projectState.canonicalCharacterImage = portraitResult.absolutePath;
          onAsset?.({ type: 'image', path: portraitResult.absolutePath, segId: 9998, label: '🎭 Reference nhân vật chính', filePath: portraitResult.absolutePath });
          return { success: true, message: `🎭 Reference nhân vật đã tạo: "${args.character_description.slice(0, 60)}"`, path: portraitResult.absolutePath };
        }
        return { success: false, error: 'Không tạo được ảnh reference nhân vật' };
      } catch (err) {
        return { success: false, error: err.message };
      }
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
          query: imgPrompt, segmentId: segId, durationSec: 5, mode: 'image', refImagePaths,
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
      // _noFallback: gọi từ nhánh dự phòng của acquire_broll → không quay lại (vòng lặp vô hạn).
      // Hết stock chưa chiếu → sang ảnh AI (_forceImage) chứ KHÔNG lấy lại clip đã dùng.
      const fallbackToBroll = () => args._noFallback
        ? { success: false, message: 'Không có stock phù hợp' }
        : executeTool('acquire_broll', { segment_id: segId, query: args.query, duration_sec: args.duration_sec || 6, _forceImage: true },
            { apiKeys, model, voice, ttsProvider, brollMode, outputDir, vieNeuSavedVoices, projectState, refImagePaths, onAsset, manualSfxList });
      try {
        const pexelsKey  = await api.getSetting('pexels_api_key',  '');
        const pixabayKey = await api.getSetting('pixabay_api_key', '');
        const dvidsKey   = (await api.getSetting('dvids_api_key', '') || '').trim();
        const provider = args.provider || (projectState.preset === 'military' ? 'dvids' : 'both');

        // Mỗi cảnh chiếm 1 "cửa sổ" thời gian trong clip nguồn; clip đưa vào Remotion chỉ chứa đúng cửa sổ đó
        const sceneSec = Number(args.duration_sec) || 6;
        const WINDOW_SEC = Math.min(20, Math.max(10, Math.round(sceneSec * 2)));
        // 2 cảnh chọn cùng 1 clip song song khi chưa biết slate dài bao nhiêu → chừa sẵn 8s
        const SLATE_ALLOW = 8;
        const usage = projectState.stockUsage || (projectState.stockUsage = {});
        // Cùng tiêu đề DVIDS = cùng 1 đoạn phim đăng lại dưới mã khác
        const keyOf = (c) => c.title
          ? `t:${c.provider}:${String(c.title).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`
          : `${c.provider}:${c.id}`;

        // Clip chưa dùng → lấy từ đầu; clip đã dùng → đoạn kế tiếp chưa chiếu nếu còn đủ dài; không có → null
        const pickWindow = (results) => {
          const fresh = results.find(c => !usage[keyOf(c)]);
          if (fresh) {
            const start = fresh.startSec || 0;
            usage[keyOf(fresh)] = { nextSec: start + SLATE_ALLOW + WINDOW_SEC };
            return { clip: fresh, key: keyOf(fresh), startSec: start, part: 1 };
          }
          for (const c of results) {
            const u = usage[keyOf(c)];
            if (c.duration && c.duration - u.nextSec >= WINDOW_SEC) {
              const start = u.nextSec;
              u.nextSec = start + WINDOW_SEC;
              u.parts = (u.parts || 1) + 1;
              return { clip: c, key: keyOf(c), startSec: start, part: u.parts };
            }
          }
          return null;
        };
        const searchPick = async (keywords, prov, apiKey) => {
          const tried = new Set();
          for (const kw of keywords) {
            if (!kw || tried.has(kw)) continue;
            tried.add(kw);
            const res = await api.stockVideoSearch({ keyword: kw, provider: prov, apiKey, perPage: 6 });
            const got = pickWindow(res?.results || []);
            if (got) return got;
          }
          return null;
        };

        const words = String(args.query || '').split(/\s+/).filter(Boolean);
        let picked = null;
        if (provider === 'dvids') {
          // dvidsKey rỗng → main dùng key cài sẵn. Query dài hay ra 0 / toàn clip đã dùng → nới dần về tên vũ khí
          picked = await searchPick([args.query, words.slice(0, 2).join(' '), words[0]], 'dvids', dvidsKey);
        }
        if (!picked && (pexelsKey || pixabayKey)) {
          const eff = !pexelsKey ? 'pixabay' : !pixabayKey ? 'pexels' : (provider === 'dvids' ? 'both' : provider);
          const apiKey = eff === 'pexels' ? pexelsKey : eff === 'pixabay' ? pixabayKey : { pexels: pexelsKey, pixabay: pixabayKey };
          picked = await searchPick([args.query, words.slice(0, 2).join(' ')], eff, apiKey);
        }
        if (!picked) return await fallbackToBroll();

        const { clip, key, part } = picked;
        const segStr = String(segId).padStart(3, '0');
        const destName = `broll/seg_${segStr}_stock.mp4`;
        // destPath null → main đặt file tạm trong thư mục temp hệ thống (không rác thư mục output)
        const dlRes = await api.stockVideoDownload({ url: clip.url, destPath: null, tempName: `stock_tmp_${segStr}_${Date.now()}.mp4` });
        const tempPath = dlRes?.filePath;

        if (dlRes?.success && tempPath) {
          let contentStart = picked.startSec;
          let stockDisplayPath = tempPath;
          try {
            // Chỉ chuyển mã đúng cửa sổ của cảnh; main tự bỏ slate/màn đen ở đầu cửa sổ
            const cr = await api.remotionCopyAudioToPublic({ srcPath: tempPath, destName, startSec: picked.startSec, maxDurationSec: WINDOW_SEC });
            if (cr?.destPath) stockDisplayPath = cr.destPath;
            if (Number.isFinite(cr?.contentStartSec)) contentStart = cr.contentStartSec;
            // Slate dài hơn phần chừa sẵn → đẩy cửa sổ kế tiếp ra sau để không chiếu lại
            usage[key].nextSec = Math.max(usage[key].nextSec, contentStart + WINDOW_SEC);
            // Bản trong output = đúng đoạn đã dùng trong video (không phải cả clip gốc → không file trùng nhau)
            if (outputDir && cr?.destPath) {
              try { await api.copyFileToOutput?.({ src: cr.destPath, dest: `${outputDir}\\asset_${segStr}_stock.mp4` }); } catch (_) {}
            }
          } catch (_) {
          } finally {
            try { await api.deleteFile?.(tempPath); } catch (_) {}
          }
          if (!projectState.assets[segId]) projectState.assets[segId] = {};
          projectState.assets[segId].brollFile = destName;
          // Clip trong public đã cắt sẵn từ contentStart → phát từ 0
          projectState.assets[segId].brollDuration = Math.min(Math.max(1, (clip.duration || WINDOW_SEC) - contentStart), WINDOW_SEC);
          projectState.assets[segId].brollStartSec = 0;
          if (clip.credit) {
            if (!projectState.stockCredits) projectState.stockCredits = [];
            if (!projectState.stockCredits.includes(clip.credit)) projectState.stockCredits.push(clip.credit);
          }
          const srcLabel = clip.provider === 'dvids' ? `DVIDS ${clip.date?.slice(0, 10) || ''}`.trim() : 'Stock';
          const partLabel = part > 1 ? ` (đoạn ${part}, từ giây ${Math.round(contentStart)})` : '';
          onAsset?.({ type: 'video', path: stockDisplayPath, filePath: stockDisplayPath, segId, label: `${srcLabel}: ${clip.title || args.query}${partLabel}`, duration: clip.duration, source: clip.provider || 'pexels' });
          return { success: true, file: destName, type: 'stock', duration: clip.duration, provider: clip.provider };
        }
        // Tải hỏng: KHÔNG trả lại cửa sổ — luồng song song có thể đã lấy đoạn kế tiếp dựa trên nó, xóa sẽ cấp trùng đoạn
        if (tempPath) { try { await api.deleteFile?.(tempPath); } catch (_) {} }
      } catch (_) {}
      return await fallbackToBroll();
    }

    case 'add_background_music': {
      if (!projectState.plan) projectState.plan = {};
      const bgVol = Math.min(0.3, Math.max(0.03, args.volume || 0.12));
      projectState.plan.bgMusic = {
        mood: args.mood || 'cinematic',
        volume: bgVol,
        genre: args.genre || '',
      };
      const mood = args.mood || 'cinematic';
      // 1. Try Pixabay / Jamendo download
      try {
        const musicPath = await api.agentFindMusic?.(mood);
        if (musicPath) {
          const mfn = `music_${mood.replace(/[^a-z0-9]/gi,'_')}.mp3`;
          const destName = `audio/${mfn}`;
          try {
            await api.remotionCopyAudioToPublic({ srcPath: musicPath, destName });
            // Store Remotion-relative path so Remotion can load it via staticFile()
            projectState.plan.bgMusic.musicFile = destName;
          } catch (_) {
            projectState.plan.bgMusic.musicFile = musicPath; // absolute fallback (may fail in render)
          }
          onAsset?.({ type: 'music', path: musicPath, segId: 0, label: `🎵 Music: ${mood}` });
          return { success: true, message: `🎵 Nhạc nền "${mood}" (vol ${bgVol}) — file: ${musicPath.split(/[\\/]/).pop()}` };
        }
      } catch (_) {}

      // 2. Fallback: synthesize BGM từ Web Audio library
      try {
        const videoDuration = projectState.plan?.total_duration_sec || 60;
        const track = moodToTrack(mood);
        onAsset?.({ type: 'info', segId: 0, path: '', label: `🎹 Tổng hợp nhạc BGM "${track.id}" (${videoDuration}s)...` });
        const wavBuffer = await synthesizeBgmToWav(track.id, videoDuration, bgVol * 2.5);
        const saveResult = await api.agentSaveSynthBgm?.({ buffer: wavBuffer, mood });
        if (saveResult?.success && saveResult.path) {
          const mfn = `music_synth_${mood.replace(/[^a-z0-9]/gi,'_')}.wav`;
          const destName = `audio/${mfn}`;
          try {
            await api.remotionCopyAudioToPublic({ srcPath: saveResult.path, destName });
            projectState.plan.bgMusic.musicFile = destName; // Remotion-relative
          } catch (_) {
            projectState.plan.bgMusic.musicFile = saveResult.path; // absolute fallback
          }
          onAsset?.({ type: 'music', path: saveResult.path, segId: 0, label: `🎹 Synth BGM: ${track.id}` });
          return { success: true, message: `🎹 Nhạc BGM tổng hợp "${track.id}" (vol ${bgVol}, ${videoDuration}s) — lưu tại ${saveResult.path.split(/[\\/]/).pop()}` };
        }
      } catch (synthErr) {
        console.warn('[add_background_music] Synth fallback failed:', synthErr?.message);
      }

      return { success: true, message: `🎵 Nhạc nền "${mood}" (vol ${bgVol}) lên lịch — sẽ tìm file khi render` };
    }

    case 'set_platform_config': {
      if (!projectState.plan) projectState.plan = {};
      projectState.plan.platform = args;
      return { success: true, message: `Platform config: ${args.platform} | hook: ${args.hook_strategy || 'auto'} | pacing: ${args.pacing || 'medium'}` };
    }

    case 'render_video': {
      // Hard cap: sau 5 lần render thất bại (kể cả sau fix) → dừng hẳn
      if (!projectState.renderAttempts) projectState.renderAttempts = 0;
      projectState.renderAttempts++;
      if (projectState.renderAttempts > 5) {
        return {
          success: false,
          error: 'render_max_retries',
          instruction: `🛑 DỪNG NGAY — render_video đã thất bại ${projectState.renderAttempts - 1} lần (kể cả sau các lần fix). KHÔNG gọi render_video thêm nữa. Báo cáo lỗi cho người dùng và dừng lại. Lỗi gốc: ${projectState.lastRenderError || 'Remotion build failed'}`,
        };
      }

      // Pre-render check: cảnh nào cần visual mà chưa có → block render, yêu cầu generate trước
      if (projectState.plan?.segments?.length > 0) {
        const needsVisual = ['ai_image', 'ai_video', 'broll'];
        const missing = projectState.plan.segments.filter(seg => {
          if (!needsVisual.includes(seg.visual_type)) return false;
          const asset = projectState.assets?.[seg.id];
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
      // Fallback to Remotion's own output dir when user hasn't set one
      const effectiveDir = outputDir || (await api.remixerGetOutputDir?.()) || 'out/remixer';
      const sep = effectiveDir.includes('\\') ? '\\' : '/';
      const outPath = `${effectiveDir}${sep}${filename}`;

      let result;
      try {
        result = await api.remixerRender({ outputPath: outPath });
      } catch (renderErr) {
        const errMsg = String(renderErr?.message || renderErr);
        projectState.lastRenderError = errMsg;
        return {
          success: false,
          error: 'remotion_crash',
          detail: errMsg.slice(0, 300),
          instruction: `❌ Remotion render crashed (lần ${projectState.renderAttempts}/3): ${errMsg.slice(0, 200)}.\n⚡ BƯỚC TIẾP THEO BẮT BUỘC:\n1. Gọi fix_render_error (error_text = lỗi trên) để patch plan\n2. Re-acquire asset còn thiếu nếu fix_render_error báo cần\n3. Gọi lại render_video`,
        };
      }
      if (!result?.success) {
        const errMsg = result?.error || 'Render failed';
        projectState.lastRenderError = errMsg;
        return {
          success: false,
          error: 'render_failed',
          detail: errMsg.slice(0, 300),
          instruction: `❌ render_video thất bại (lần ${projectState.renderAttempts}/3): ${errMsg.slice(0, 200)}.\n⚡ BƯỚC TIẾP THEO BẮT BUỘC:\n1. Gọi fix_render_error (error_text = lỗi trên) để patch plan\n2. Re-acquire bất kỳ asset nào fix_render_error báo thiếu (acquire_broll / generate_tts)\n3. Gọi lại render_video${projectState.renderAttempts >= 3 ? '\n⚠️ ĐÃY LÀ LẦN CUỐI — nếu vẫn fail sau fix thì dừng lại và báo lỗi.' : ''}`,
        };
      }

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

      return {
        success: true,
        output_path: projectState.outputPath,
        qa: { score: projectState.qaResult?.score, passed: projectState.qaResult?.passed, issues_count: projectState.qaResult?.issues?.length || 0 },
      };
    }

    case 'fix_render_error': {
      const result = await api.agentFixRenderError({ errorText: args.error_text || '' });
      if (!result?.success) return { success: false, error: result?.error || 'fix_render_error thất bại' };

      // Giảm renderAttempts 1 để dành slot cho lần retry sau fix
      if (projectState.renderAttempts > 0) projectState.renderAttempts--;

      const mv = result.missing_visuals || [];
      const audioMissing = mv.filter(m => m.missing_audio);
      const visualMissing = mv.filter(m => !m.missing_audio);

      let instruction = `✅ fix_render_error hoàn tất: ${result.message}\n`;
      if (audioMissing.length > 0) {
        instruction += `🎙️ Cần generate TTS lại cho ${audioMissing.length} cảnh: ${audioMissing.map(m => `scene ${m.id}`).join(', ')} → gọi generate_tts cho từng cảnh.\n`;
      }
      if (visualMissing.length > 0) {
        instruction += `🖼️ Cần tạo lại visual cho ${visualMissing.length} cảnh: ${visualMissing.map(m => `scene ${m.id}(${m.old_type})`).join(', ')} → gọi acquire_broll hoặc generate_image.\n`;
      }
      if (mv.length === 0) {
        instruction += `✅ Không có asset nào bị hỏng. Có thể gọi lại render_video ngay.`;
      } else {
        instruction += `Sau khi re-acquire xong → gọi lại render_video.`;
      }

      return {
        success: true,
        fixes: result.fixes,
        missing_visuals: mv,
        instruction,
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

      // ── 5c. TTS COVERAGE hard fail ───────────────────────────
      const narrationSegs = segments.filter(s => s.narration);
      const ttsReadySegs  = narrationSegs.filter(s => !!(assets[s.id]?.ttsFile));
      const ttsCoverage   = narrationSegs.length > 0 ? ttsReadySegs.length / narrationSegs.length : 1;
      let hardFail = false;
      if (ttsCoverage < 0.8) {
        hardFail = true;
        issues.push({
          severity: 'critical',
          type: 'tts_coverage_fail',
          message: `HARD FAIL: TTS coverage ${Math.round(ttsCoverage * 100)}% (${ttsReadySegs.length}/${narrationSegs.length} cảnh). PHẢI generate_tts thêm ${narrationSegs.length - ttsReadySegs.length} cảnh nữa trước khi render.`,
        });
        const missingTtsIds = narrationSegs.filter(s => !assets[s.id]?.ttsFile).map(s => s.id);
        patch.push({ action: 'generate_missing_tts', missing_scene_ids: missingTtsIds.slice(0, 20) });
      }
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

      // ── 5b. DURATION: actual vs target ──────────────────────
      const targetDur = plan?.total_duration_sec || 0;
      const actualDurSec = segments.reduce((acc, seg) => {
        const asset = assets[seg.id] || {};
        return acc + Math.max(asset.ttsDuration || 0, seg.duration_sec || 5);
      }, 0);
      if (targetDur > 0 && actualDurSec < targetDur * 0.75) {
        const deficit = Math.round(targetDur - actualDurSec);
        const extraScenes = Math.ceil(deficit / 6);
        issues.push({
          severity: 'high',
          type: 'duration_too_short',
          message: `Video thực tế ${Math.round(actualDurSec)}s nhưng yêu cầu ${targetDur}s (thiếu ~${deficit}s). Cần thêm ~${extraScenes} cảnh hoặc kéo dài narration.`,
        });
        patch.push({ action: 'add_scenes_for_duration', deficit_sec: deficit, extra_scenes_needed: extraScenes });
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
      const lang = projectState.lang || args.lang || 'vi';
      const isVi = lang === 'vi';
      const plan = projectState.plan || {};
      const videoTitle = plan.title || '';
      // Mốc thời gian lấy đúng như video đã dựng (buildEditPlan) — không tự cộng ước lượng
      const ep = buildEditPlan(plan, projectState.assets || {});
      const segs = ep.segments || [];
      const totalSec = (ep.project?.totalFrames || 0) / 30;
      const fmtSrt = (sec) => {
        const ms = Math.round(sec * 1000);
        const p = (n, w = 2) => String(n).padStart(w, '0');
        return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
      };
      const fmtChap = (sec) => {
        const s = Math.floor(sec);
        const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, '0');
        return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`;
      };
      const srt = segs.filter(sg => sg.narration?.text).map((sg, i) =>
        `${i + 1}\n${fmtSrt(sg.startFrame / 30)} --> ${fmtSrt((sg.startFrame + sg.durationFrames) / 30)}\n${sg.narration.text}`).join('\n\n');

      // Số chương theo độ dài video (chương YouTube tối thiểu 10s)
      const [minCh, maxCh] = totalSec < 120 ? [3, 5] : totalSec < 360 ? [5, 8] : totalSec < 900 ? [7, 12] : [10, 15];
      const isMilitary = projectState.preset === 'military';
      const langLabel = { vi: 'Tiếng Việt', en: 'English', ja: 'Japanese', ko: 'Korean' }[lang] || 'Tiếng Việt';
      const extraRules = [
        `  - Đây là VIDEO ${isMilitary ? 'TÀI LIỆU QUÂN SỰ' : 'THÔNG TIN / TÀI LIỆU'} dựa trên sự thật, KHÔNG phải truyện hư cấu. Tiêu đề và mô tả phải đúng nội dung kịch bản, không giật tít sai sự thật.`,
        `  - CHAPTERS (BẮT BUỘC): dùng mốc thời gian thật trong SRT. Mỗi chương 1 dòng đúng định dạng YouTube "MM:SS Tên chương" (không dùng HH:MM:SS nếu video dưới 1 giờ). Dòng đầu tiên BẮT BUỘC là "00:00". Tổng ${minCh}–${maxCh} chương, mỗi chương dài ít nhất 10 giây, tên chương 2–6 từ, không đánh số, không lặp ý, không mô tả dài dòng.`,
        `  - CTA (BẮT BUỘC): ngay sau đoạn giới thiệu, 1 dòng mời Like 👍, Đăng ký kênh và bật chuông 🔔; kèm 1 câu hỏi mời khán giả bình luận liên quan chủ đề. Cuối mô tả nhắc lại CTA ngắn gọn.`,
        `  - Thumbnail textOnImage: 2–5 từ, KHÔNG lặp lại nguyên văn tiêu đề.`,
        `  - Viết toàn bộ bằng ${langLabel}.`,
      ].join('\n');
      const disclaimer = isVi
        ? '⚠️ Video có sử dụng công cụ AI hỗ trợ tạo hình minh họa và giọng đọc. Thông tin được tổng hợp từ các nguồn công khai.'
        : '⚠️ This video uses AI tools to assist with illustrations and voice-over. Information is compiled from publicly available sources.';

      try {
        const raw = await generateSeoMetadata(apiKeys, srt || videoTitle, lang, '', null, model, [], { disclaimer, extraRules });
        const best = [...(raw.titles || [])].sort((x, y) => (y.score || 0) - (x.score || 0))[0];
        let description = String(raw.description || '');

        // Chuẩn hóa chương: HH:MM:SS dưới 1 giờ → MM:SS; phải bắt đầu 00:00, tăng dần, cách nhau ≥ 10s
        const toSec = (t) => t.split(':').map(Number).reduce((acc, n) => acc * 60 + n, 0);
        // Cho phép ký hiệu đứng trước mốc ("⏱️ 00:00 Intro", "• 00:00 Intro")
        const chapRe = /^\s*[^\d\n]{0,4}?(\d{1,2}(?::\d{2}){1,2})\s*[-–—:]?\s*(.+)$/u;
        const lines = description.split('\n');
        const chapters = [];
        lines.forEach((ln, idx) => {
          const m = ln.match(chapRe);
          if (!m) return;
          const sec = toSec(m[1]);
          if (sec > totalSec + 1) return;
          if (chapters.length && sec - chapters[chapters.length - 1].sec < 10) return;
          chapters.push({ idx, sec, name: m[2].trim() });
        });
        const chaptersValid = chapters.length >= 3 && chapters[0].sec === 0;
        let timestamps;
        if (chaptersValid) {
          chapters.forEach(c => { lines[c.idx] = `${fmtChap(c.sec)} ${c.name}`; });
          const keep = new Set(chapters.map(c => c.idx));
          description = lines.filter((ln, idx) => keep.has(idx) || !chapRe.test(ln)).join('\n');
          timestamps = chapters.map(c => `${fmtChap(c.sec)} ${c.name}`).join('\n');
        } else {
          // AI không tạo được chương hợp lệ → dựng từ dàn ý (outline) chia đều theo thời lượng
          const outline = Array.isArray(plan.outline) && plan.outline.length >= 3 ? plan.outline.slice(0, maxCh) : null;
          if (outline) {
            timestamps = outline.map((name, i) => `${fmtChap(i === 0 ? 0 : (totalSec * i) / outline.length)} ${name}`).join('\n');
            description = `${description}\n\n${isVi ? '📌 Nội dung' : '📌 Chapters'}:\n${timestamps}`;
          } else {
            timestamps = '';
          }
        }
        if (!/subscribe|đăng ký|đăng kí/i.test(description)) {
          description += isVi
            ? '\n\n👍 Nếu thấy video hữu ích, hãy Like, Đăng ký kênh và bật chuông 🔔 để không bỏ lỡ video mới!'
            : '\n\n👍 If you enjoyed this video, please Like, Subscribe and hit the bell 🔔 so you never miss a new upload!';
        }

        const credits = (projectState.stockCredits || []).filter(c => c.startsWith('DVIDS'));
        if (credits.length > 0 && !description.includes('dvidshub.net')) {
          const dod = isVi
            ? 'Việc sử dụng hình ảnh của Bộ Quốc phòng Mỹ không có nghĩa là Bộ Quốc phòng Mỹ tán thành nội dung này.'
            : 'The appearance of U.S. Department of Defense (DoD) visual information does not imply or constitute DoD endorsement.';
          description += `\n\nFootage: ${credits.slice(0, 5).join('; ')} (dvidshub.net). ${dod}`;
        }

        const seoData = {
          title: (best?.title || videoTitle).slice(0, 100),
          titleOptions: (raw.titles || []).map(t => ({ title: t.title, score: t.score })),
          description,
          tags: String(raw.tags || '').split(',').map(t => t.trim()).filter(Boolean),
          hashtags: [...new Set(description.match(/#[\p{L}\p{N}_]+/gu) || [])].join(' '),
          timestamps,
          thumbnailText: raw.thumbnailPrompts?.[0]?.textOnImage || '',
          keywordResearch: raw.keywordResearch || [],
        };
        projectState.seoData = seoData;
        onAsset?.({ type: 'seo', segId: 0, path: '', label: `📊 SEO: ${seoData.title}`, seoData });
        return { success: true, title: seoData.title, chapters: timestamps.split('\n').filter(Boolean).length, thumbnail_text: seoData.thumbnailText, message: `✅ SEO tạo xong: "${seoData.title}"` };
      } catch (err) {
        projectState.seoData = { title: videoTitle, description: '', tags: [], hashtags: '', timestamps: '' };
        return { success: false, error: err.message };
      }
    }

    case 'generate_thumbnail': {
      if (!apiKeys?.length) return { success: false, error: 'No API key' };

      const outDir = outputDir || (projectState.outputPath ? projectState.outputPath.split(/[\\/]/).slice(0,-1).join('\\') : '.');
      const sep = outDir.includes('\\') ? '\\' : '/';
      const thumbPath = `${outDir}${sep}thumbnail.png`;

      // Chữ thumbnail phải ngắn: tiêu đề SEO dài (>7 từ) → dùng hook ngắn do generate_seo tạo
      let titleText = args.title || projectState.seoData?.thumbnailText || projectState.seoData?.title || projectState.plan?.title || 'Video';
      const wordCount = (x) => String(x || '').trim().split(/\s+/).filter(Boolean).length;
      if (wordCount(titleText) > 7 && projectState.seoData?.thumbnailText && wordCount(projectState.seoData.thumbnailText) < wordCount(titleText)) {
        titleText = projectState.seoData.thumbnailText;
      }
      // Bỏ highlight/badge lặp từ của tiêu đề (vd title "…Most Dangerous…" + badge "DANGEROUS" + highlight "MOST DANGEROUS")
      const normWords = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 2);
      const titleWords = new Set(normWords(titleText));
      const repeatsTitle = (x) => { const w = normWords(x); return w.length > 0 && w.filter(t => titleWords.has(t)).length / w.length >= 0.5; };
      let highlightText = args.highlight || '';
      if (repeatsTitle(highlightText)) highlightText = '';
      let badgeText = args.badge || '';
      const hlWords = normWords(highlightText);
      if (repeatsTitle(badgeText) || normWords(badgeText).some(w => hlWords.includes(w))) {
        badgeText = projectState.preset === 'military' ? ((projectState.lang || 'vi') === 'vi' ? '🎖️ QUÂN SỰ' : '🎖️ MILITARY') : '';
      }
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
        highlight:     highlightText,
        badge:         badgeText,
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
export function buildSystemPrompt(preset, lang = 'vi', hasRefImages = false, brollMode = 'image', duration = 0) {
  const presetGuides = {
    auto:        'Tự động phân tích topic → chọn preset phù hợp nhất. Visual mix: broll(stock) 45%, ai_image 30%, graphic 10%, chart 5%, text 10%. TUYỆT ĐỐI KHÔNG để quá 2 cảnh graphic/text liên tiếp. Cảnh đầu PHẢI là text (hook). Cảnh cuối PHẢI là text (CTA). Xen kẽ: visual thật (broll/ai_image) xen kẽ với graphic/text đều. PHẢI generate visual asset (acquire_broll hoặc generate_image) cho ít nhất 70% số cảnh.',
    documentary: 'Cinematic documentary: research → broll 50% (stock footage thực tế, broll_media=video) + ai_image 25% (concept visual, broll_media=image) + chart 15% + graphic 5% + text 5%. PHẢI acquire_broll cho ít nhất 75% cảnh. Nhịp chậm sâu sắc. music: cinematic/dramatic.',
    short:       'Short-form viral (TikTok/Reels/Shorts): hook 0–3s cực mạnh → 5–12 cảnh → broll(stock) 30% + ai_image 30% + text 20% + graphic 20% → dynamic captions → SFX mạnh → 9:16. Tổng 30–90s. music: upbeat.',
    story:       'Kể chuyện cảm xúc: story arc → ai_image 45% + broll(stock) 25% + text 15% + graphic 15%. Narrative arc rõ, ngôn ngữ gần gũi. music: inspiring.',
    explainer:   'Giải thích từng bước: research → chart 20% + graphic 20% (stat_card+percentage_bar) + motion_graphic 10% + ai_image 20% + text 15% + broll 15%. Câu ngắn rõ ràng, CTA cuối. music: calm.',
    news:        'Tin tức/báo cáo: broll stock 45% (thực tế, người thật, broll_media=video) + chart 20% + graphic 15% + text 10% + ai_image 10%. Giọng trung lập, dữ liệu có nguồn. music: neutral.',
    remake:      'Phân tích video nguồn → tạo góc nhìn mới → script mới → TTS → chọn lọc broll + ai_video + graphic → QA. Không chỉ crop/flip/speed.',
    military: `KÊNH QUÂN SỰ — phân tích vũ khí, quốc phòng, lịch sử quân sự, tập trận. Giọng phim tài liệu: chắc chắn, phân tích, trung lập.

① NGHIÊN CỨU TRƯỚC (BẮT BUỘC): gọi research_topic(depth="deep", focus="thông số kỹ thuật, năm biên chế, quốc gia sử dụng, giá thành, lịch sử tác chiến") TRƯỚC plan_video.
   • Mọi con số (tầm bắn, tốc độ, tải trọng, giá, số lượng) PHẢI lấy từ research. Không chắc → nói "ước tính", "theo công bố của nhà sản xuất". TUYỆT ĐỐI không bịa thông số.

② DẠNG VIDEO — chọn theo yêu cầu:
   • So sánh A vs B: mỗi tiêu chí 1 cảnh graphic percentage_bar/stat_card + footage xen kẽ → kết luận cân bằng (không phán "bên nào thắng" tuyệt đối).
   • Giải mã vũ khí: bối cảnh ra đời → cấu tạo/nguyên lý (graphic timeline_flow) → thông số (stat_card) → vai trò chiến trường.
   • Top N: đếm ngược, mỗi mục = hook ngắn + footage + 1 stat_card.
   • Lịch sử: timeline_flow theo mốc năm + footage + ảnh concept bản đồ.
   • Tin tập trận: ai/đâu/khi nào/mục đích — chỉ nêu điều đã xác nhận, ghi nguồn.

③ VISUAL MIX: stock video DVIDS 55% (broll_media="video", provider="dvids") + graphic/chart 25% (stat_card thông số, percentage_bar so sánh, timeline_flow lịch sử/quy trình) + ai_image 10% (bản đồ chiến lược, sơ đồ, silhouette, màn hình radar — KHÔNG ảnh AI giả cảnh chiến đấu thật) + text 10%.
   • MỌI cảnh video: provider="dvids". Query tiếng Anh, tên chính thức: "F-35A takeoff", "M1A2 Abrams live fire", "HIMARS rocket launch", "Patriot missile battery", "Arleigh Burke destroyer", "aircraft carrier flight deck", "AH-64 Apache", "B-2 Spirit flyover", "Marines amphibious assault", "paratroopers airborne jump".
   • Không có footage DVIDS của vũ khí nước khác (Nga, Trung Quốc, Việt Nam...) → dùng footage bối cảnh chung (radar, phòng không, tàu chiến) + caption "Hình ảnh minh họa", hoặc dùng graphic/ai_image bản đồ.

④ TRUNG THỰC FOOTAGE (BẮT BUỘC): footage DVIDS là quân đội Mỹ và đồng minh trong tập trận/huấn luyện. Narration/caption KHÔNG được gọi đó là quân đội nước khác, KHÔNG được nói là cảnh chiến sự thật đang diễn ra. Cảnh không khớp chính xác chủ đề → caption ghi "Hình ảnh minh họa".

⑤ AN TOÀN NỘI DUNG (giữ kiếm tiền YouTube): không cảnh máu me/thương vong, không cổ vũ bạo lực, không tuyên truyền, không đứng về phe nào trong xung đột đang diễn ra — trình bày dữ kiện đã xác minh và nêu nguồn. Không hướng dẫn chế tạo/sử dụng vũ khí.

⑥ ÂM THANH & NHỊP: add_background_music mood="epic" (so sánh/top) hoặc "cinematic"/"dramatic" (lịch sử/phân tích). SFX: hook=bass_drop_01, lộ thông số=impact_02, radar/công nghệ=scan_01, cơ khí=mechanical_01, căng thẳng=drone_01, cao trào=riser_01→deep_hit_01. TTS emotion="serious" speed 0.95; hook và kết "dramatic". Transition: cut/whip/zoom_in cho nhịp nhanh, glitch cho tiết lộ công nghệ. Màu accent: xanh ô-liu #65a30d, xám thép #64748b, cam cảnh báo #f59e0b, đỏ #dc2626.

⑦ HOOK mở đầu bằng con số gây sốc hoặc câu hỏi: "Một quả tên lửa Patriot giá khoảng 4 triệu đô. Vậy vì sao Mỹ vẫn bắn nó vào drone giá vài chục nghìn?" — con số phải khớp research.
⑧ THUMBNAIL: character_prompt mô tả VŨ KHÍ/PHƯƠNG TIỆN (vd "F-35 fighter jet banking against dramatic sunset sky, cinematic"), KHÔNG vẽ người lính; highlight = thông số ấn tượng; badge "⚔️ SO SÁNH" / "🔥 TOP 5" / "🎯 GIẢI MÃ".`,
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

━━━ NHÂN VẬT CHÍNH — QUYẾT ĐỊNH THÔNG MINH ━━━
${hasRefImages ? `Người dùng đính kèm ẢNH THAM CHIẾU nhân vật chính. Phân tích ngay:
  • Giới tính, độ tuổi, dân tộc (theo ảnh — ưu tiên ảnh hơn rule ngôn ngữ)
  • Màu tóc, kiểu tóc, chiều dài tóc
  • Màu da, đặc điểm khuôn mặt (mắt, môi, xương gò má)
  • Trang phục: màu sắc, kiểu dáng, phong cách
  • Vóc dáng, đặc điểm nhận dạng đặc biệt

→ Khi gọi plan_video: điền character_description = toàn bộ mô tả trên (tiếng Anh).
→ SAU set_platform_config: gọi create_character_reference(character_description=...) để tạo ảnh reference.
→ Hệ thống tự gửi ảnh gốc đến Imagen/Veo làm reference — KHÔNG cần embed vào prompt.` : `Không có ảnh tham chiếu. PHÂN TÍCH CHỦ ĐỀ để quyết định:

▶ VIDEO CÓ NHÂN VẬT XUYÊN SUỐT (story, drama, vlog, tutorial có người dẫn, hướng dẫn cá nhân):
  → Sau set_platform_config: gọi create_character_reference với mô tả nhân vật (tiếng Anh):
     Ethnicity phải là: ${langCulture.ethnicity}
     Bối cảnh phải là: ${langCulture.setting}
     Ví dụ: "${langCulture.exampleChar}"
  → Hệ thống dùng ảnh này làm reference cho mọi cảnh có nhân vật sau đó.

▶ VIDEO KHÁI NIỆM / GIÁO DỤC / TÀI CHÍNH / FACT (không có nhân vật cụ thể xuyên suốt):
  → KHÔNG gọi create_character_reference — không cần nhân vật nhất quán
  → Visual: dùng object/concept/landscape cho ai_image; stock video thực tế cho broll
  → Ví dụ: "tại sao người giàu càng giàu", "tips đầu tư", "lịch sử tiền tệ" → KHÔNG có nhân vật chính`}

LUẬT NHẤT QUÁN — áp dụng cho MỌI cảnh có người:
⚡ broll_query/visual_prompt PHẢI chứa đầy đủ character_description
   Đúng: "${langCulture.exampleScene}"
   Sai: "woman in café" (thiếu đặc điểm nhận dạng + bối cảnh văn hóa)
⚡ Nếu cảnh không có nhân vật (thiên nhiên, object, graphic) → không thêm mô tả người.
⚡ Trang phục nhân vật: nhất quán hoặc thay đổi có chủ đích (nếu kịch bản đổi trang phục → ghi rõ trong character_description của cảnh đó).`;

  const brollSection = brollMode === 'auto' ? `

━━━ CHẾ ĐỘ VISUAL: AUTO MIX (AI TỰ QUYẾT TỪNG CẢNH) ━━━
⚡ AUTO MODE: Hệ thống tự chuyển visual type → broll_media. Gọi acquire_broll cho TẤT CẢ cảnh visual.
🚫 KHÔNG dùng generate_image trong auto mode — acquire_broll xử lý cả ảnh AI lẫn stock video.

Quy tắc chọn broll_media khi gọi acquire_broll (PHẢI dùng đúng giá trị từ must_acquire):
  • broll_media="image" → ẢNH AI Imagen. PHẢI LÀ VẬT THỂ/CẢNH/CONCEPT — KHÔNG phải người/nhân vật.
    ✅ Tốt: "golden coins waterfall abundance", "compound growth graph glowing blue neon", "luxury real estate aerial view sunset", "money tree golden leaves", "stack of cash bokeh elegant"
    ❌ Sai: "businessman office", "rich person", "man in suit", "woman entrepreneur" — dùng broll_media="video" nếu cần người thật
  • broll_media="video" → STOCK VIDEO Pexels/Pixabay. Cảnh thực tế: người thật, hành động, địa điểm.
    Từ khóa tiếng Anh ngắn: "hands counting money", "people working office", "chef cooking kitchen", "city skyline aerial"

Mix mục tiêu: 45% stock video (broll_media=video) + 30% ảnh AI (broll_media=image) + 25% text/graphic.
Xen kẽ đa dạng — KHÔNG để toàn ảnh AI hoặc toàn stock.` : brollMode === 'image' ? `

━━━ CHẾ ĐỘ VISUAL: ẢNH AI (IMAGEN) — BẮT BUỘC ━━━
⚠️ Người dùng chọn ẢNH AI. MỌI cảnh visual ĐỀU phải gọi acquire_broll với broll_media=image — Imagen AI tạo ảnh theo prompt.
🚫 TUYỆT ĐỐI KHÔNG gọi search_stock_footage trong chế độ này.
🚫 TUYỆT ĐỐI KHÔNG gọi generate_image (generate_image chỉ tạo Remotion JSX đơn giản, KHÔNG phải ảnh Imagen chất lượng cao).
🖼️ Visual mix: broll(Imagen) 70-80% + text 10-15% + graphic/chart 10-15%. KHÔNG có video AI.
- Dùng visual_type: "broll" cho mọi cảnh visual — hệ thống tự dùng Imagen AI.
- Prompt tiếng Anh, chi tiết, mô tả rõ nội dung ảnh: "A professional woman in modern office presenting data, warm lighting, photorealistic, 16:9"
- Thêm style descriptor nhất quán: "cinematic", "professional", "vibrant", v.v.` : brollMode === 'stock' ? `

━━━ CHẾ ĐỘ VISUAL: STOCK VIDEO (PEXELS/PIXABAY) — BẮT BUỘC ━━━
⚠️ Người dùng chọn STOCK VIDEO. MỌI cảnh visual ĐỀU phải gọi search_stock_footage trước.
✅ Nếu search_stock_footage không có kết quả phù hợp → fallback acquire_broll(broll_media=image) — Imagen AI tạo ảnh.
🚫 TUYỆT ĐỐI KHÔNG gọi acquire_broll(broll_media=image) trừ khi search_stock thất bại.
🚫 TUYỆT ĐỐI KHÔNG gọi generate_image.
📹 Visual mix: stock video (Pexels/Pixabay) 70-80% + text 10-15% + graphic/chart 10-15%.
- Dùng visual_type: "broll" cho mọi cảnh visual — hệ thống tự gọi search_stock_footage.
- Từ khóa tìm stock: tiếng Anh, ngắn gọn, mô tả hành động/cảnh thực tế: "people working office", "city traffic aerial"` : '';

  // Scene duration: 3-8s regardless of video length (user preference)
  const avgSecPerScene = duration <= 0 ? 5
    : duration <= 120 ? 4
    : duration <= 300 ? 5
    : duration <= 600 ? 6
    : duration <= 900 ? 7
    : 8;
  const durationGuide = duration > 0
    ? (() => {
        const targetScenes = Math.round(duration / avgSecPerScene);
        const mins = Math.floor(duration / 60);
        const secs = duration % 60;
        const dStr = mins > 0 ? `${mins} phút${secs > 0 ? ` ${secs}s` : ''}` : `${secs}s`;
        return `\n━━━ THỜI LƯỢNG YÊU CẦU: ${dStr} (${duration}s) ━━━
⚡ total_duration_sec trong plan_video PHẢI = ${duration}
⚡ Số scene cần tạo: ~${targetScenes} cảnh (mỗi cảnh ~${avgSecPerScene}s trung bình với video dài này)
⚡ Phân bổ đều nội dung: ${targetScenes} cảnh × ${avgSecPerScene}s = ${duration}s
⚡ KHÔNG được tạo ít hơn ${Math.round(targetScenes * 0.85)} cảnh — phải đạt đủ thời lượng yêu cầu
⚡ Mỗi cảnh narration phải đủ dài (~${avgSecPerScene}s = ~${Math.round(avgSecPerScene * 2.25)} từ). KHÔNG cắt nội dung.${duration >= 180 ? `
⚡ VIDEO DÀI → LẬP KẾ HOẠCH THEO ĐỢT (không viết ${targetScenes} cảnh trong 1 lần gọi):
   1. plan_video: điền outline (dàn ý 5–10 phần của TOÀN BỘ video) + 15–20 cảnh ĐẦU TIÊN, total_duration_sec=${duration}
   2. Hệ thống trả plan_incomplete=true → gọi extend_plan mỗi lần 15–20 cảnh tiếp theo, nối mạch last_narration, theo outline
   3. Lặp đến khi hệ thống báo "Plan hoàn chỉnh" (đợt cuối is_final_part=true, cảnh cuối CTA) → mới sang BƯỚC A sản xuất` : ''}`;
      })()
    : '';

  return `Bạn là FLUXY AI AGENT — nhà sản xuất video AI đỉnh cao, chuyên tạo content viral cho YouTube, TikTok, Facebook Reels. Bạn là AI Agent thực thụ: TỰ ĐỘNG gọi BẤT KỲ tool nào cần thiết như một người dùng thực sự. Mục tiêu: tạo video giữ chân người xem lâu nhất, nhiều tương tác nhất.${durationGuide}

━━━ PHONG CÁCH ━━━
${presetGuides[preset] || presetGuides.auto}${brollMode !== 'auto' ? `\n⛔ OVERRIDE CHẾ ĐỘ VISUAL: Bỏ qua tỉ lệ visual mix bên trên. Người dùng đã chọn chế độ ${brollMode === 'image' ? 'ẢNH AI (IMAGE)' : 'STOCK VIDEO (PEXELS/PIXABAY)'} — xem hướng dẫn CHẾ ĐỘ VISUAL ở cuối prompt này và tuân thủ TUYỆT ĐỐI.` : ''}

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
   Mỗi segment PHẢI có transition_type ĐA DẠNG — KHÔNG lặp cùng loại 2 cảnh liên tiếp:
   Cảnh 1 (hook): zoom_in hoặc glitch | Cảnh cuối (CTA): fade hoặc zoom_out
   Cảnh giữa xoay vòng: slide_left → cut → whip → slide_up → zoom_in → slide_right → blur → slide_down → zoom_out → fade
   Quy tắc chọn: cut/whip=nhanh/TikTok; slide_*=liệt kê/step-by-step; zoom_in=nhấn mạnh điểm chính; glitch=shock/dramatic; blur=cảm xúc/dreamlike; fade=kết thúc/chuyển nhẹ
🎯 set_platform_config — Cấu hình platform (youtube/tiktok/facebook) + chiến lược. GỌI NGAY SAU plan_video.
🎭 create_character_reference — Tạo ảnh reference nhân vật. GỌI SAU set_platform_config KHI VÀ CHỈ KHI video có nhân vật xuyên suốt (story/drama/vlog). KHÔNG gọi cho video concept/tài chính/edu không có nhân vật cụ thể.
📦 batch_acquire_all — ⭐⭐ CÔNG CỤ VISUAL DUY NHẤT. Gộp TẤT CẢ visual (image + video) vào 1 lần gọi. Nội bộ tự chạy song song: image group (8 luồng) + video group (10 luồng) đồng thời. broll_media="image"→ảnh AI Imagen; broll_media="video"→stock Pexels/Pixabay. KHÔNG gọi batch_acquire_images hay batch_search_stock riêng nữa.
🎙️ batch_generate_tts — ⭐⭐ CÔNG CỤ TTS DUY NHẤT. Gộp TẤT CẢ cảnh có narration vào 1 lần gọi (4 luồng song song nội bộ). Gọi CÙNG LÚC với batch_acquire_all trong BƯỚC A. KHÔNG gọi generate_tts từng cảnh riêng lẻ.
🎥 acquire_broll — CHỈ dùng khi retry 1 cảnh cụ thể thất bại sau batch_acquire_all. KHÔNG gọi cho batch.
📹 search_stock_footage — CHỈ dùng khi retry 1 cảnh stock cụ thể thất bại. KHÔNG gọi cho batch.
🎙️ generate_tts — CHỈ dùng khi retry 1 cảnh TTS cụ thể thất bại sau batch_generate_tts.
🎖️ NGUỒN DVIDS (provider="dvids") — footage B-roll quân đội Mỹ thật, xếp theo độ liên quan. Dùng cho cảnh video khi chủ đề là quân sự / quốc phòng / vũ khí / tập trận / không quân / hải quân / NATO.
   Query NGẮN 2–4 từ: TÊN VŨ KHÍ đứng đầu + 1 hành động ("HIMARS launch", "HIMARS reload", "Abrams firing"). KHÔNG thêm tính từ/bối cảnh ("desert terrain", "dramatic", "mobility") — DVIDS tìm theo từ khóa, càng dài càng lạc đề.
   Query: tiếng Anh, danh từ quân sự cụ thể: "F-35 takeoff", "aircraft carrier flight deck", "HIMARS live fire", "Marines amphibious landing", "Patriot missile launch", "Army tank training".
   KHÔNG dùng dvids cho chủ đề khác (tài chính, đời sống, công nghệ dân sự) — kết quả sẽ lạc đề.
   Đây là footage của quân đội Mỹ — narration KHÔNG được mô tả nó là quân đội nước khác hay là cảnh chiến sự thật đang diễn ra.
   Không có kết quả → hệ thống tự chuyển sang Pexels/Pixabay.
🖼️ generate_image — ${brollMode === 'image' ? '⛔ KHÔNG dùng trong IMAGE AI mode. Dùng acquire_broll (broll_media=image) thay thế.' : 'Tạo ảnh Remotion JSX. Chỉ dùng cho illustration/infographic, KHÔNG dùng thay acquire_broll.'}
🎙️ generate_tts — ⛔ Chỉ dùng khi retry 1 cảnh TTS cụ thể. Bình thường dùng batch_generate_tts.
🔊 add_sfx — Thêm SFX tại timestamp cụ thể. Gọi sau plan_video. Thư viện 50 SFX thực tế:
   TRANSITIONS: whoosh_01(nhanh) whoosh_02(vừa) whoosh_03(mạnh) reverse_whoosh_01/02(reveal) riser_01/02(build-up) downlifter_01(landing) pop_01/02(text pop)
   IMPACTS: impact_01(nhẹ) impact_02(vừa) impact_03(mạnh) deep_hit_01/02(trầm) bass_drop_01(dramatic) metal_hit_01/02(industrial)
   CINEMATIC: drone_01/02(tension/dark) heartbeat_01/02(suspense) mechanical_01/02(machine) page_01(archive) paper_01(research)
   TECH: glitch_01/02(digital) buzz_01/02(tech) scan_01(analysis) typing_01(research) focus_01(camera) shutter_01(photo)
   NATURE: wind_01 rain_01 thunder_01 fire_01 water_01 birds_01
   UI: success_01 error_01 notification_01 tick_01 beep_01/02 click_01/02
🎵 add_background_music — Thêm nhạc nền BGM. Hệ thống tự tìm nhạc thật (Pixabay/Jamendo) hoặc synthesize BGM offline nếu cần — LUÔN hoạt động. GỌI TRƯỚC quality_check. Chọn mood phù hợp nội dung: epic(hùng tráng), dramatic(kịch tính), lofi(thư giãn), upbeat(năng lượng), cinematic(phim), corporate/mysterious(tech).
✅ quality_check — Kiểm tra chất lượng TRƯỚC KHI render. Gọi SAU khi đã có đủ TTS + visual + nhạc. Trả về score (0-10), issues và patch[].
   Nếu score ≥ 6.5 và không có critical issue → gọi render_video ngay.
   Nếu patch[] có lỗi → tự fix từng scene (re-generate TTS/broll/image), rồi gọi quality_check lại. Giới hạn 2 vòng fix.
🎬 render_video — Render video cuối. CHỈ gọi sau khi quality_check đạt (score ≥ 6.5, không hardFail).
🔧 fix_render_error — Tự động patch edit-plan khi render fail: xóa file hỏng, sửa path nhạc, báo cảnh nào cần re-acquire. Gọi NGAY khi render_video thất bại, TRƯỚC KHI retry.
📊 generate_seo — Tạo tiêu đề YouTube tối ưu, mô tả, tags, hashtags. Gọi SAU render thành công.
🖼️ generate_thumbnail — Tạo thumbnail YouTube 1920×1080: Imagen3 sinh ảnh nhân vật + text bold + badge overlay. Gọi SAU generate_seo. PHẢI truyền character_prompt (tiếng Anh, mô tả nhân vật/cảnh phù hợp chủ đề video), title = thumbnail_text mà generate_seo trả về (2–6 từ, KHÔNG dùng tiêu đề SEO dài), highlight (con số/thông số, không lặp từ của title), badge (nhãn chủ đề 1–2 từ, không lặp từ của title), layout (character_right/left/center), accent_color. Ba phần chữ này phải KHÁC NHAU hoàn toàn — không lặp một từ khóa 2–3 lần.
🗑️ cleanup_output — Dọn dẹp file tạm. Gọi CUỐI CÙNG sau thumbnail xong.

━━━ QUY TẮC VISUAL BẮT BUỘC (KHÔNG ĐƯỢC VI PHẠM) ━━━
⚠️ Mỗi cảnh có visual_type = "broll" PHẢI được xử lý bởi acquire_broll (broll_media=video → stock Pexels/Pixabay).
⚠️ Mỗi cảnh có visual_type = "ai_image": AUTO MODE → acquire_broll (broll_media=image, Imagen AI); Image mode → acquire_broll (broll_media=image). KHÔNG dùng generate_image.
⚠️ Mỗi cảnh có visual_type = "ai_video" → xử lý như broll: acquire_broll(broll_media=video → stock Pexels/Pixabay).
⚠️ KHÔNG ĐƯỢC chỉ dùng text/graphic cho phần lớn cảnh. Text/graphic TỐI ĐA 25% tổng số cảnh.
⚠️ KHÔNG ĐƯỢC skip acquire_broll/batch_acquire_images để tiết kiệm — người dùng cần visual thật.
⚡ TỐI ƯU TỐC ĐỘ: Gộp TẤT CẢ visual (image + video) → 1 lần gọi batch_acquire_all. Tool tự tách và chạy song song cả 2 nhóm đồng thời. Gọi cùng lúc với generate_tts trong CÙNG 1 response. KHÔNG gọi riêng lẻ từng cảnh.

━━━ 8 LOẠI VISUAL — CHỌN THEO NỘI DUNG TỪNG CẢNH ━━━
1. text         — Hook mạnh, slogan, câu hỏi gây tò mò, CTA, transition giữa ý lớn.
                  → Cảnh đầu PHẢI là text (hook). Cảnh cuối PHẢI là text (CTA).
2. graphic      — Cảnh có con số, %, danh sách, so sánh, bảng biểu, quy trình, icon+text.
                  Templates:
                  • stat_card: 1-3 số lớn đếm lên. graphic_data={label:"Tiêu đề",values:[80,20,5],labels:["Mục A","Mục B","Mục C"]}
                  • percentage_bar: nhiều mục so sánh % (cột bar fill). graphic_data={label:"Tiêu đề",items:[{label:"Người giàu",value:80},{label:"Người nghèo",value:20}]}
                  • timeline_flow: quy trình từng bước, flow chart. graphic_data={label:"Tiêu đề",steps:["Bước 1: Mở tài khoản","Bước 2: Nạp vốn","Bước 3: Đầu tư"]}
                  • default: icon lớn + tiêu đề + mô tả. graphic_data={heading:"Câu nổi bật",subtext:"Mô tả thêm",icon:"💰"}
3. chart        — Biểu đồ so sánh, thống kê nhiều mục, % tỉ lệ. Dùng percentage_bar template.
                  → Ưu tiên khi có 3+ số liệu cần so sánh trực quan.
                  graphic_template="percentage_bar" + graphic_data={label:"So sánh",items:[{label:"A",value:70},{label:"B",value:30}]}
4. motion_graphic — Đồ họa chuyển động: số đếm lên animated, icon animation.
                  → Dùng khi cần 1-3 con số lớn nổi bật. Template stat_card.
                  graphic_template="stat_card" + graphic_data={label:"Tiêu đề",values:[10000000,500,37],labels:["Người vay","Ngân hàng","Lãi suất %"]}
5. ai_image     — Cảnh khái niệm trừu tượng, cảm xúc, ý tưởng, minh họa creative.
                  → Dùng khi không có footage thực tế hoặc muốn visual đẹp sáng tạo.
                  ⛔ TUYỆT ĐỐI KHÔNG dùng broll_query có từ "businessman", "person", "man", "woman", "people" cho ai_image.
                  ✅ broll_query PHẢI là VẬT THỂ/CẢNH cụ thể: "golden coins overflowing treasure chest", "compound interest curve glowing neon blue", "luxury real estate aerial golden hour", "stack of dollar bills bokeh", "stock market heatmap data visualization", "money tree growing golden leaves", "investment portfolio dashboard glowing"
6. broll        — ${brollMode === 'stock' ? '⭐ LOẠI CHÍNH trong STOCK VIDEO mode. Gọi search_stock_footage trước, fail → acquire_broll(broll_media=image).' : 'Video stock thực tế từ Pexels/Pixabay. Người thật, địa điểm thật. → Gọi search_stock_footage trước, nếu fail thì acquire_broll(broll_media=video).'}
8. illustration — Infographic AI-rendered: nhân vật + badge + stat card. Dùng khi cần
                  minh họa phức tạp hơn ai_image: có ref nhân vật + dữ liệu đi kèm.

🎯 QUY TẮC CHỌN VISUAL — ĐỌC KỸ TỪNG DÒNG:

⚡ GRAPHIC/CHART ĐƯỢC ƯU TIÊN TUYỆT ĐỐI khi narration chứa:
  → Số liệu cụ thể (%, tiền, số lượng, tỉ lệ) → graphic (stat_card hoặc percentage_bar)
  → Danh sách 2+ mục so sánh → graphic (percentage_bar)
  → Các bước quy trình/cách làm → graphic (timeline_flow)
  → Khái niệm trừu tượng CÓ thể minh họa bằng icon+câu ngắn → graphic (default)
⚡ GRAPHIC không cần acquire_broll — hiện ngay, không tốn API, hiệu ứng đẹp hơn ảnh.
⚡ Mỗi video PHẢI có 15-25% cảnh graphic/chart — video tài chính/giáo dục cần nhiều hơn.

${brollMode === 'stock'
  ? '• Cảnh thật (người/địa điểm/hành động) → broll (search_stock_footage trước). Fail → acquire_broll(broll_media=image).\n• Từ khóa stock: tiếng Anh, ngắn gọn: "business meeting", "city traffic", "cooking food"'
  : brollMode === 'image'
  ? '• Cảnh concept/cảm xúc/nhân vật/ý tưởng → acquire_broll(broll_media=image, Imagen AI). KHÔNG dùng search_stock_footage.\n• NHƯNG: cảnh có số liệu/danh sách/quy trình → PHẢI dùng graphic, KHÔNG phải ai_image.\n• Prompt ảnh AI: tiếng Anh, chi tiết nội dung, thêm style nhất quán (vd: "cinematic, warm tones, professional")'
  : '• Người thật / địa điểm / hành động cụ thể thực → broll (search_stock_footage trước, fail → acquire_broll broll_media=video)\n• Cảnh concept/cảm xúc/trừu tượng/sáng tạo → ai_image (acquire_broll broll_media=image)\n• AUTO MIX: xen kẽ broll(stock video) + ai_image(Imagen) + graphic để video đa dạng và sinh động'}
• 3+ số liệu cần so sánh trực quan → chart/graphic (template=percentage_bar) + graphic_data={label:"Tiêu đề",items:[{label:"A",value:70},{label:"B",value:30}]}
• 1-3 con số lớn nổi bật / đếm lên → graphic (template=stat_card) + graphic_data={label:"Tiêu đề",values:[80,20,5],labels:["Nhãn A","Nhãn B","Nhãn C"]}
• Quy trình/cách làm/timeline → graphic (template=timeline_flow) + graphic_data={label:"Tiêu đề",steps:["Bước 1: ...","Bước 2: ...","Bước 3: ..."]}
• Icon lớn + câu ngắn + mô tả → graphic (template=default) + graphic_data={heading:"Câu nổi bật",subtext:"Mô tả thêm",icon:"💰"}
• Khái niệm trừu tượng / cảm xúc thuần túy / cảnh đời thực → ai_image
• Hook / key statement / CTA → text
• Có ref nhân vật + muốn infographic đẹp → illustration
🚨 KHI CHỌN graphic/chart/motion_graphic: BẮT BUỘC điền graphic_data đúng format. Thiếu graphic_data = template hiện rỗng, mất toàn bộ hiệu ứng hoạt hình!

QUY TẮC BẮT BUỘC:
• Phân tích NỘI DUNG từng đoạn narration → chọn visual_type phù hợp nhất
• KHÔNG dùng ai_image quá 50% tổng số cảnh — phải có graphic/chart cho cảnh số liệu/giáo dục
• KHÔNG dùng broll quá 60% tổng số cảnh — phải mix đều các loại
• Sau 2 cảnh cùng loại visual liên tiếp → PHẢI chuyển loại khác
• Mỗi cảnh phải có MỤC ĐÍCH KỂ CHUYỆN rõ ràng
• Transition AI TỰ CHỌN: cut=TikTok fast | fade=cảm xúc/chậm | whip=năng động | glitch=tech/dramatic | blur=dream/abstract | slide_left/right=liệt kê/step | slide_up=reveal | zoom_in=nhấn mạnh

━━━ VISUAL HARD RULES (BẮT BUỘC — VI PHẠM = QA FAIL) ━━━
🚫 Subtitle KHÔNG phải visual. Narration text KHÔNG phải visual. Background gradient KHÔNG phải visual.
🚫 Một cảnh CHỈ có text + background = KHÔNG có visual. Phải generate visual asset thật.
🚫 KHÔNG dùng ai_image cho cảnh có số liệu, %, danh sách, so sánh, quy trình → PHẢI dùng graphic.
🚫 KHÔNG dùng graphic mà bỏ trống graphic_data → template render rỗng, video xấu.
✅ MỖI cảnh PHẢI có semantic visual asset (broll/ai_image/illustration) TRỪ KHI là hook/CTA/số liệu rõ ràng cần text/graphic.
✅ Tối đa 15% tổng thời lượng video là cảnh text-only (hook, CTA, stat highlight). Ví dụ video 90s → tối đa 13.5s text.
✅ Visual coverage ≥ 85% tổng thời lượng là mục tiêu. ≥ 50% là ngưỡng HARD FAIL.
✅ Video tài chính/giáo dục/explainer: MỤC TIÊU 15-25% cảnh là graphic/chart (stat_card, percentage_bar, timeline_flow).
✅ generate_image gọi VeoEngine/Imagen4 trước (ảnh thật) → Remotion illustration là last resort. Sau khi thành công → asset TỰ ĐỘNG được gắn vào timeline.
✅ QA quality_check sẽ đo visual_coverage theo giây thực — không thể qua QA nếu text-only quá nhiều.
⚡ Ưu tiên visual: ${brollMode === 'stock' ? 'Stock video Pexels/Pixabay (search_stock_footage) > Ảnh AI Imagen (acquire_broll broll_media=image) > Graphic/Chart > Text.' : brollMode === 'image' ? 'Graphic/Chart (cảnh số liệu) > Ảnh AI Imagen (acquire_broll broll_media=image) > Illustration > Text. KHÔNG dùng stock/Pexels, KHÔNG dùng video.' : 'Stock video Pexels (broll_media=video) + Ảnh AI Imagen (broll_media=image) + Graphic/Chart > Illustration > Text. MIX cả 3 loại (stock + AI image + graphic) để video đa dạng.'}
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
• "quân sự / vũ khí / tên lửa / tiêm kích / xe tăng / tàu chiến / phòng không / tập trận / quốc phòng / military" → áp dụng quy tắc kênh QUÂN SỰ: research sâu, footage provider="dvids", graphic thông số, music epic
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
      → ⏱️ NARRATION PHẢI ĐỦ DÀI theo duration_sec: tiếng Việt ~2.5 từ/giây, tiếng Anh ~2.8 từ/giây
         Ví dụ: duration_sec=6 → narration ≥15 từ TV / ≥17 từ EN
         duration_sec=8 → narration ≥20 từ TV / ≥22 từ EN
         KHÔNG viết narration 5-8 từ cho cảnh 6-7 giây — TTS sẽ ra video ngắn hơn nhiều so với yêu cầu
      → Số cảnh đủ để đạt total_duration_sec: (total_duration_sec / avg_scene_dur) cảnh tối thiểu
         Ví dụ: 3 phút (180s) ÷ 6s/cảnh = 30 cảnh. KHÔNG plan 14 cảnh cho video 3 phút.
  1d. set_platform_config → platform + format

◆ PHASE 2+3 — AUDIO + VISUAL SONG SONG TỐI ĐA
  ⚡⚡ SIÊU QUAN TRỌNG — THỨ TỰ BẮT BUỘC:
  BƯỚC A (1 response DUY NHẤT): gửi TẤT CẢ cùng lúc trong CÙNG 1 response:
      → batch_acquire_all với TẤT CẢ cảnh visual (image + video gộp 1 lần)
      → batch_generate_tts với TẤT CẢ cảnh có narration (1 lần duy nhất, 4 song song nội bộ)
      → add_background_music + add_sfx trong cùng response đó
      → 3 loại công việc này KHÔNG phụ thuộc nhau → chạy đồng thời hoàn toàn
      ⚠️ KHÔNG gọi riêng từng segment: generate_tts hay acquire_broll → dùng batch tương ứng
      ⚠️ KHÔNG gọi batch_acquire_all trước rồi batch_generate_tts sau — PHẢI cùng 1 response
      ⚠️ Ví dụ 20 cảnh: 1 lần batch_acquire_all(20 visual) + 1 lần batch_generate_tts(20 TTS) = 2 tool calls
  BƯỚC B: Chờ kết quả. Nếu batch_generate_tts báo một số cảnh thất bại → dùng generate_tts retry từng cảnh đó. Lặp đến khi ≥ 80% TTS xong.
  🚫 TUYỆT ĐỐI KHÔNG gọi quality_check cho đến khi ≥ 80% cảnh đã có TTS.
  🚫 TUYỆT ĐỐI KHÔNG tách TTS thành nhiều lần gọi batch_generate_tts — 1 lần duy nhất trong BƯỚC A.
  ⚠️ Sau khi nhận kết quả TTS: duration thực tế sẽ được dùng cho timeline (không hard-code)
  ⚠️ broll: search_stock_footage TRƯỚC → fail → acquire_broll(broll_media=video)
  ⚠️ KHÔNG lặp cùng 1 asset — kiểm tra assetRegistry

◆ PHASE 4 — QA TRƯỚC → RENDER
  4a. quality_check → CHỈ gọi sau PHASE 2+3 hoàn thành (TTS ≥ 80%)
      → Nếu score ≥ 6.5 và không hardFail → gọi render_video ngay
      → Nếu hardFail[tts_coverage_fail] → generate_tts cho missing_scene_ids trong patch → quality_check lại
      → Nếu có patch khác → fix từng scene → quality_check lại
      → KHÔNG gọi render_video khi quality_check còn hardFail (dù đã gọi nhiều lần)
  4b. render_video → CHỈ gọi sau khi quality_check passed (không còn hardFail)
  4b.fail. Nếu render_video thất bại:
      → Gọi fix_render_error (truyền error_text)
      → Re-acquire bất kỳ asset nào fix_render_error báo thiếu (acquire_broll / generate_tts)
      → Gọi lại render_video (tối đa 5 lần tổng, fix_render_error reset 1 lượt)
  4c. Báo cáo kết quả: duration thực tế, scene count, QA score, output path

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
   Phần còn lại 70%+ PHẢI là broll / ai_image / illustration.
🚫 Sau plan_video → PHẢI gọi đúng tool cho từng visual_type:
   • visual_type=broll        → search_stock_footage trước; fail → acquire_broll(broll_media=video). IMAGE mode: acquire_broll(broll_media=image)
   • visual_type=ai_image     → acquire_broll(broll_media=image, Imagen AI)
   • visual_type=illustration → generate_image (Remotion JSX)
🚫 plan_video trả về must_acquire=[...] → BẮT BUỘC xử lý TỪNG id trong đó.
🚫 KHÔNG bỏ qua cảnh nào. KHÔNG dùng placeholder. KHÔNG text thay thế visual.
${brollMode === 'auto' ? '🚫 KHÔNG lặp cùng 1 loại 3 cảnh liên tiếp — xen kẽ đa dạng.\n✅ Mỗi video phải có ít nhất 2 loại visual khác nhau (stock video + AI image + illustration).' : brollMode === 'stock' ? '🎯 Chế độ STOCK VIDEO: MỌI cảnh visual → search_stock_footage, fail → acquire_broll(broll_media=image). KHÔNG bắt buộc đa dạng loại visual.' : `🎯 Chế độ IMAGE AI: TOÀN BỘ cảnh visual dùng acquire_broll(broll_media=image). KHÔNG bắt buộc đa dạng loại visual.`}${refSection}${brollSection}`;
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

// ── Auto-generate better visual prompts from narration ───────────────────────
export async function improveVisualPrompts(segments, apiKeys = [], model = 'gemini-3.5-flash', topic = '') {
  if (!segments?.length || !apiKeys?.length) return segments;
  const toProcess = segments.filter(s =>
    ['broll','ai_image','illustration'].includes(s.visual_type) && s.narration?.trim()
  );
  if (!toProcess.length) return segments;

  const SYSTEM = `You are a visual director for YouTube/TikTok videos. Convert each Vietnamese narration into a short, specific English image prompt for Imagen AI.

RULES:
• Describe WHAT TO SHOW that ILLUSTRATES the narration — not the literal words
• NO generic "businessman in office" unless narration is literally about a businessman
• Use VISUAL METAPHORS: money concepts → "gold coins waterfall", "stock chart rising", "money tree growing"; success → "mountain summit"; debt → "heavy chains"; time → "hourglass sand"; investment → "seed growing into tree"
• Include mood/lighting: "cinematic lighting", "dramatic shadows", "warm golden hour"
• Max 20 words per prompt, English only
• Each prompt MUST be DIFFERENT from others

Topic: ${topic || 'general'}

OUTPUT: JSON array in same order — ["prompt for seg 0", "prompt for seg 1", ...]`;

  const CHUNK_SIZE = Math.max(3, Math.ceil(toProcess.length / Math.min(apiKeys.length, 8)));
  const chunks = [];
  for (let i = 0; i < toProcess.length; i += CHUNK_SIZE) chunks.push(toProcess.slice(i, i + CHUNK_SIZE));

  const callChunk = async (chunk, keyIdx) => {
    const input = JSON.stringify(chunk.map((s, i) => ({ i, narration: s.narration.slice(0, 150) })));
    const keysToRace = [apiKeys[keyIdx % apiKeys.length], apiKeys[(keyIdx + 1) % apiKeys.length]].filter(Boolean);
    const makeCall = (apiKey) => {
      const { GoogleGenAI } = require('@google/genai');
      const g = new GoogleGenAI({ apiKey });
      return g.models.generateContent({
        model,
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: `Create visual prompts:\n${input}` }] }],
        config: { temperature: 0.85, maxOutputTokens: 600 },
      });
    };
    const res = await Promise.any(keysToRace.map(k => makeCall(k)));
    const raw = (res.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    const match = raw.match(/\[[\s\S]*\]/);
    return match ? JSON.parse(match[0]) : null;
  };

  try {
    const chunkResults = await Promise.all(chunks.map((chunk, i) => callChunk(chunk, i * 2).catch(() => null)));
    const promptsFlat = chunkResults.flatMap((r, i) => r || chunks[i].map(s => s.visual_prompt || s.broll_query || ''));
    let pi = 0;
    return segments.map(seg => {
      if (!['broll','ai_image','illustration'].includes(seg.visual_type) || !seg.narration?.trim()) return seg;
      const better = promptsFlat[pi++];
      if (!better || typeof better !== 'string') return seg;
      return { ...seg, visual_prompt: better, broll_query: better };
    });
  } catch (_) {
    return segments;
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
  const mergedParams = { ...params };
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
const STREAM_TIMEOUT_MS = 2 * 60 * 1000; // 2 phút tối đa mỗi key
export async function geminiStreamWithRotation(apiKeys, model, params, onChunk) {
  const MAX_ROUNDS = 2;
  const BACKOFF = [5000, 12000];
  let lastErr;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (round > 0) await sleep(BACKOFF[round - 1]);
    let allRetryable = true;
    for (let i = 0; i < apiKeys.length; i++) {
      try {
        const genAI = new GoogleGenAI({ apiKey: apiKeys[i] });
        // Wrap toàn bộ stream trong timeout 2 phút
        const streamResult = await new Promise(async (resolve, reject) => {
          const timer = setTimeout(() => reject(Object.assign(
            new Error(`Stream timeout ${STREAM_TIMEOUT_MS/1000}s`), { isTimeout: true }
          )), STREAM_TIMEOUT_MS);
          try {
            const stream = await genAI.models.generateContentStream({ model, ...params });
            let full = '';
            for await (const chunk of stream) {
              const piece = chunk.candidates?.[0]?.content?.parts?.[0]?.text || '';
              if (piece) { full += piece; onChunk?.(piece, full); }
            }
            clearTimeout(timer);
            resolve(full);
          } catch (e) { clearTimeout(timer); reject(e); }
        });
        return streamResult;
      } catch (err) {
        lastErr = err;
        if (isKeyError(err) || err?.isTimeout || isRetryable(err)) continue;
        allRetryable = false; throw err;
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
7. add_background_music → nhạc nền
8. quality_check → kiểm tra chất lượng (TRƯỚC render)
9. render_video → render NẾU quality_check đạt ≥6.5

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
  7. add_background_music → nhạc nền
  8. quality_check → kiểm tra chất lượng (TRƯỚC render)
  9. render_video → render NẾU quality_check đạt ≥6.5

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
