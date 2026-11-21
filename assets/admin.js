(() => {
  const cfg=window.APP_CONFIG||{};
  const configured=cfg.SUPABASE_URL&&!cfg.SUPABASE_URL.includes("YOUR-PROJECT")&&cfg.SUPABASE_ANON_KEY&&!cfg.SUPABASE_ANON_KEY.includes("YOUR_SUPABASE");
  const db=configured&&window.supabase?window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY):null;
  const $=id=>document.getElementById(id);
  let currentUser=null, profile=null, submissions=[], selectedId=null;
  const statusNames={new:"جديدة",reviewing:"قيد المراجعة",assigned:"محالة",in_progress:"قيد المعالجة",resolved:"تمت المعالجة",closed:"مغلقة"};
  const typeNames={suggestion:"اقتراح",complaint:"شكوى",problem:"مشكلة",initiative:"مبادرة"};
  const showNotice=(el,msg,error=false)=>{el.classList.remove("hidden","error");if(error)el.classList.add("error");el.textContent=msg;};
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const date=s=>s?new Date(s).toLocaleString("ar-IQ"):"—";

  $("login-form").addEventListener("submit",async e=>{
    e.preventDefault();
    if(!db)return showNotice($("login-message"),"أضف بيانات Supabase في assets/config.js أولاً.",true);
    const {error}=await db.auth.signInWithPassword({email:$("email").value.trim(),password:$("password").value});
    if(error)return showNotice($("login-message"),"تعذر تسجيل الدخول. تحقق من البيانات أو من تفعيل حسابك.",true);
    await initSession();
  });
  $("logout-button").addEventListener("click",async()=>{await db.auth.signOut();location.reload();});
  $("refresh-button").addEventListener("click",loadSubmissions);
  $("search-input").addEventListener("input",renderList);
  $("status-filter").addEventListener("change",renderList);

  async function initSession(){
    if(!db)return;
    const {data:{user}}=await db.auth.getUser();
    if(!user){$("login-view").classList.remove("hidden");$("dashboard-view").classList.add("hidden");return;}
    const {data:p,error}=await db.from("profiles").select("id,display_name,role,active").eq("id",user.id).single();
    if(error||!p||!p.active){await db.auth.signOut();$("login-view").classList.remove("hidden");return showNotice($("login-message"),"هذا الحساب غير مخوّل للدخول إلى لوحة الإدارة.",true);}
    currentUser=user;profile=p;
    $("login-view").classList.add("hidden");$("dashboard-view").classList.remove("hidden");
    $("welcome-user").textContent=`مرحباً ${p.display_name||user.email} · ${p.role==="admin"?"مدير النظام":p.role==="manager"?"مسؤول":"مشرف"}`;
    await loadSubmissions();
  }
  async function loadSubmissions(){
    const {data,error}=await db.from("submissions").select("id,reference_number,type,category,title,content,is_anonymous,student_name,class_name,status,public_update,assigned_to,created_at,updated_at").order("created_at",{ascending:false}).limit(300);
    if(error){$("message-list").innerHTML='<p class="muted">تعذر تحميل الرسائل. تحقق من سياسات الصلاحيات.</p>';return;}
    submissions=data||[];renderStats();renderList();
    if(selectedId){const found=submissions.find(x=>x.id===selectedId);if(found)renderDetail(found);else selectedId=null;}
  }
  function renderStats(){
    $("stat-total").textContent=submissions.length;
    $("stat-new").textContent=submissions.filter(x=>x.status==="new").length;
    $("stat-progress").textContent=submissions.filter(x=>["reviewing","assigned","in_progress"].includes(x.status)).length;
    $("stat-done").textContent=submissions.filter(x=>["resolved","closed"].includes(x.status)).length;
  }
  function renderList(){
    const q=$("search-input").value.trim().toLowerCase(), st=$("status-filter").value;
    const rows=submissions.filter(x=>(!st||x.status===st)&&(!q||`${x.title} ${x.reference_number} ${x.category}`.toLowerCase().includes(q)));
    $("message-list").innerHTML=rows.length?rows.map(x=>`<button class="message-item ${selectedId===x.id?"active":""}" data-id="${x.id}"><strong>${esc(x.title)}</strong><div class="message-meta"><span>${esc(typeNames[x.type]||x.type)}</span><span>•</span><span>${esc(statusNames[x.status]||x.status)}</span></div><div class="message-meta"><span>${esc(x.reference_number)}</span><span>•</span><span>${date(x.created_at)}</span></div></button>`).join(""):'<p class="muted">لا توجد رسائل مطابقة.</p>';
    document.querySelectorAll(".message-item").forEach(b=>b.addEventListener("click",()=>{selectedId=b.dataset.id;renderList();renderDetail(submissions.find(x=>x.id===selectedId));}));
  }
  async function renderDetail(x){
    if(!x)return;
    const {data:replies}=await db.from("responses").select("id,message,is_public,created_at,profiles(display_name)").eq("submission_id",x.id).eq("is_public",true).order("created_at",{ascending:true});
    const {data:staff}=await db.from("profiles").select("id,display_name,role").eq("active",true).order("display_name");
    const assigned=staff||[];
    $("detail-panel").innerHTML=`
      <div class="detail-title"><div><span class="eyebrow">${esc(x.reference_number)}</span><h2>${esc(x.title)}</h2></div><span class="status-pill">${esc(statusNames[x.status]||x.status)}</span></div>
      <div class="detail-meta"><div>نوع الرسالة<b>${esc(typeNames[x.type]||x.type)}</b></div><div>التصنيف<b>${esc(x.category)}</b></div><div>هوية المرسل<b>${x.is_anonymous?"مجهول الهوية":esc(x.student_name||"اسم غير متوفر")}</b></div><div>الصف والشعبة<b>${esc(x.class_name||"غير محدد")}</b></div><div>تاريخ الإرسال<b>${date(x.created_at)}</b></div><div>آخر تحديث<b>${date(x.updated_at)}</b></div></div>
      <div class="detail-body">${esc(x.content)}</div>
      <div><b>الإفادة الظاهرة للطالب</b><p>${esc(x.public_update||"لا توجد إفادة منشورة.")}</p></div>
      <div class="reply-list">${(replies||[]).map(r=>`<div class="reply-item">${esc(r.message)}<small>${esc(r.profiles?.display_name||"الإدارة")} · ${date(r.created_at)}</small></div>`).join("")}</div>
      <div class="admin-actions">
        <label>حالة الرسالة<select id="edit-status">${Object.entries(statusNames).map(([k,v])=>`<option value="${k}" ${x.status===k?"selected":""}>${v}</option>`).join("")}</select></label>
        <label>إحالة إلى مسؤول<select id="edit-assignee"><option value="">غير محالة</option>${assigned.map(p=>`<option value="${p.id}" ${x.assigned_to===p.id?"selected":""}>${esc(p.display_name)} (${esc(p.role)})</option>`).join("")}</select></label>
        <label>إفادة مختصرة تظهر للطالب<textarea id="edit-public-update" maxlength="1000" placeholder="اكتب تحديثاً مناسباً لصاحب الرسالة...">${esc(x.public_update||"")}</textarea></label>
        <button id="save-detail" class="button button-primary">حفظ التغييرات</button>
        <label>إضافة رد يظهر للطالب<textarea id="new-reply" maxlength="2000" placeholder="اكتب رد الإدارة..."></textarea></label>
        <button id="send-reply" class="button button-dark">نشر الرد</button>
        <div id="detail-message" class="notice hidden" role="status"></div>
      </div>`;
    $("save-detail").addEventListener("click",async()=>{
      const update={status:$("edit-status").value,assigned_to:$("edit-assignee").value||null,public_update:$("edit-public-update").value.trim()||null,updated_at:new Date().toISOString()};
      const {error}=await db.from("submissions").update(update).eq("id",x.id);
      if(error)return showNotice($("detail-message"),"تعذر حفظ التغييرات. قد لا تملك الصلاحية المطلوبة.",true);
      showNotice($("detail-message"),"تم حفظ التغييرات.");await loadSubmissions();
    });
    $("send-reply").addEventListener("click",async()=>{
      const message=$("new-reply").value.trim();if(message.length<2)return showNotice($("detail-message"),"اكتب رداً قبل النشر.",true);
      const {error}=await db.from("responses").insert({submission_id:x.id,author_id:currentUser.id,message,is_public:true});
      if(error)return showNotice($("detail-message"),"تعذر نشر الرد. تحقق من صلاحيات حسابك.",true);
      showNotice($("detail-message"),"تم نشر الرد.");await renderDetail(x);
    });
  }
  if(db){db.auth.onAuthStateChange(()=>{});initSession();}
  else {showNotice($("login-message"),"قبل الاستخدام: أضف رابط Supabase والمفتاح العام في assets/config.js.",true);}
})();