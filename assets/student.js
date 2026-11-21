(() => {
  const cfg = window.APP_CONFIG || {};
  const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("YOUR-PROJECT") &&
    cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes("YOUR_SUPABASE");
  const client = configured && window.supabase ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  const $ = (id) => document.getElementById(id);
  const show = (el, msg, error=false) => { el.classList.remove("hidden","error"); if(error) el.classList.add("error"); el.textContent=msg; };
  const form = $("submission-form");
  const identityInputs = document.querySelectorAll('input[name="identity"]');
  identityInputs.forEach(input => input.addEventListener("change", () => {
    const named = document.querySelector('input[name="identity"]:checked').value === "named";
    $("student-name-wrap").classList.toggle("hidden", !named);
    $("student-name").required = named;
  }));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = $("form-message"), button=$("send-button");
    if (!client) return show(message,"لم تُضبط بيانات Supabase بعد. افتح assets/config.js وأضف رابط المشروع والمفتاح العام.",true);
    const identity = document.querySelector('input[name="identity"]:checked').value;
    const payload = {
      p_type: $("type").value,
      p_category: $("category").value,
      p_title: $("title").value.trim(),
      p_content: $("content").value.trim(),
      p_class_name: $("class-name").value.trim() || null,
      p_is_anonymous: identity === "anonymous",
      p_student_name: identity === "named" ? $("student-name").value.trim() : null
    };
    if(payload.p_content.length < 10) return show(message,"يرجى كتابة تفاصيل لا تقل عن 10 أحرف.",true);
    button.disabled=true; button.textContent="جارٍ إرسال الرسالة...";
    const {data,error}=await client.rpc("submit_suggestion",payload);
    button.disabled=false; button.textContent="إرسال الرسالة";
    if(error) return show(message,"تعذر إرسال الرسالة. تحقق من الاتصال وحاول مجدداً. إذا استمرت المشكلة، تواصل مع إدارة المدرسة.",true);
    const result=Array.isArray(data)?data[0]:data;
    if(!result || !result.reference_number || !result.tracking_token) return show(message,"لم يصل تأكيد الإرسال. لا تعِد الإرسال قبل مراجعة الإدارة.",true);
    form.reset(); $("student-name-wrap").classList.add("hidden"); $("student-name").required=false;
    message.classList.remove("hidden","error");
    message.innerHTML=`<strong>تم استلام رسالتك بنجاح.</strong><p>الرقم المرجعي: <b>${escapeHtml(result.reference_number)}</b></p><p>رمز المتابعة السري: <b>${escapeHtml(result.tracking_token)}</b></p><p>احتفظ بالرقم والرمز معاً. لن نعرض رمز المتابعة مرة أخرى.</p>`;
  });

  $("track-form").addEventListener("submit", async (event)=>{
    event.preventDefault();
    const box=$("track-result");
    if(!client) return show(box,"لم تُضبط بيانات Supabase بعد.",true);
    const ref=$("track-reference").value.trim(), token=$("track-token").value.trim();
    const {data,error}=await client.rpc("track_suggestion",{p_reference_number:ref,p_tracking_token:token});
    if(error || !data || (Array.isArray(data)&&!data.length)) return show(box,"لم نعثر على رسالة مطابقة. تحقق من الرقم والرمز.",true);
    const item=Array.isArray(data)?data[0]:data;
    const replies=(item.public_replies||[]).map(r=>`<p><b>رد الإدارة:</b> ${escapeHtml(r.message)}</p>`).join("");
    box.classList.remove("hidden","error");
    box.innerHTML=`<b>${escapeHtml(item.title)}</b><p>الحالة: <span class="status-pill">${escapeHtml(statusLabel(item.status))}</span></p><p>${escapeHtml(item.public_update||"لا توجد إفادة إضافية حالياً.")}</p>${replies||"<small>لا توجد ردود منشورة حتى الآن.</small>"}`;
  });

  function statusLabel(s){return ({new:"جديدة",reviewing:"قيد المراجعة",assigned:"محالة إلى مسؤول",in_progress:"قيد المعالجة",resolved:"تمت المعالجة",closed:"مغلقة"})[s]||s;}
  function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
})();