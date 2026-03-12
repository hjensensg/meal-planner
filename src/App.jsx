import { useState, useEffect } from "react";

// ─── Storage helpers ──────────────────────────────────────────────────────────
const STORAGE_KEYS = { RECIPES: "mp_recipes", PLAN: "mp_mealplan", TAGS: "mp_custom_tags" };
async function loadShared(key) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}
async function saveShared(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

// ─── Constants ────────────────────────────────────────────────────────────────
const MEAL_SLOTS = ["Breakfast", "Morning Snack", "Lunch", "Afternoon Snack", "Dinner"];
const SLOT_ICONS = { "Breakfast":"☀️","Morning Snack":"🍎","Lunch":"🥗","Afternoon Snack":"🍵","Dinner":"🌙" };
const SLOT_COLORS = { "Breakfast":"#fff7ed","Morning Snack":"#f0fdf4","Lunch":"#f0f9ff","Afternoon Snack":"#fdf4ff","Dinner":"#faf5ff" };
const SLOT_ACCENT = { "Breakfast":"#ea580c","Morning Snack":"#16a34a","Lunch":"#0284c7","Afternoon Snack":"#9333ea","Dinner":"#7c3aed" };
const DEFAULT_TAGS = ["Vegetarian","Vegan","Gluten-Free","Dairy-Free","Quick","High-Protein","Low-Carb","Comfort Food","Kid-Friendly","Meal-Prep"];
const TAG_COLORS = ["#bbf7d0","#a7f3d0","#fef3c7","#ddd6fe","#fce7f3","#fee2e2","#e0f2fe","#fef9c3","#ffedd5","#e0e7ff","#fae8ff","#ecfdf5","#fff1f2","#f0f9ff","#fefce8","#f5f3ff"];
const DAYS = Array.from({ length: 10 }, (_, i) => {
  const d = new Date(); d.setDate(d.getDate() + i);
  return { label: d.toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" }), short: d.toLocaleDateString("en-US", { weekday:"short" }), date: d.getDate(), index: i };
});

function genId() { return Math.random().toString(36).slice(2,10); }

// ─── AI helpers ───────────────────────────────────────────────────────────────
// ─── API Key ──────────────────────────────────────────────────────────────────
// Replace the empty string below with your Anthropic API key to enable AI features.
// Get one free at: https://console.anthropic.com
// IMPORTANT: For a public app, use an environment variable instead of pasting the key here.
// In Vercel: add REACT_APP_ANTHROPIC_API_KEY in Settings → Environment Variables
// then reference it as: process.env.REACT_APP_ANTHROPIC_API_KEY
const ANTHROPIC_API_KEY = process.env.REACT_APP_ANTHROPIC_API_KEY || "";

// callClaude — calls the Anthropic API with optional extra body params (e.g. tools)
async function callClaude(prompt, extraBody={}) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("No API key set. Add your Anthropic API key to enable AI features.");
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model:"claude-sonnet-4-20250514",
      max_tokens:2000,
      messages:[{role:"user",content:prompt}],
      ...extraBody
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "API error");
  // Collect all text blocks (web_search returns multiple blocks)
  return (data.content||[]).map(b => b.type==="text" ? b.text : "").join("");
}

// parseRecipeFromUrl — uses Claude's web_search tool to actually visit and read the page
async function parseRecipeFromUrl(url, onStatus) {
  onStatus("Visiting the recipe page\u2026");
  const prompt =
    `Visit this URL and extract the full recipe from it: ${url}\n\n` +
    `You MUST use your web_search tool to actually read the page.\n` +
    `Then respond ONLY with a single valid JSON object — no markdown, no backticks, no explanation before or after.\n` +
    `If you cannot find a recipe, respond with exactly: {"error":"no recipe found"}\n\n` +
    `Required JSON format (fill in real values from the page):\n` +
    `{` +
    `"name":"Recipe Name",` +
    `"ingredients":["200g pasta","2 tbsp olive oil","3 garlic cloves"],` +
    `"instructions":"Step 1: ... Step 2: ... Step 3: ...",` +
    `"cookingTime":"30 minutes",` +
    `"tags":["Vegetarian","Quick","Pasta"],` +
    `"sourceUrl":"${url}"` +
    `}`;

  onStatus("Extracting ingredients and instructions\u2026");
  const result = await callClaude(prompt, {
    tools:[{ type:"web_search_20250305", name:"web_search" }]
  });

  const cleaned = result.replace(/```json|```/g,"").trim();
  // Extract JSON — find the first { ... } block in the response
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Could not extract the recipe. Make sure the URL points directly to a recipe page.");
  let parsed;
  try { parsed = JSON.parse(jsonMatch[0]); }
  catch { throw new Error("Could not read the recipe data. Please try again."); }
  if (parsed.error || !parsed.name) {
    throw new Error("No recipe was found at that URL. Try a URL that points directly to a single recipe (not a search page or homepage).");
  }
  return parsed;
}

async function recommendRecipe(recipes, context) {
  if (!recipes.length) return "No recipes in library yet. Add some first!";
  const list = recipes.map(r => `- ${r.name} (tags: ${r.tags?.join(", ")}, rating: ${r.rating||0}/5)`).join("\n");
  return callClaude(`You are a friendly meal planning assistant. Available recipes:\n${list}\n\nUser context: "${context||"surprise me"}"\n\nRecommend 2-3 recipes with brief, warm explanations.`);
}

// ─── useIsMobile ──────────────────────────────────────────────────────────────
function useIsMobile() {
  const [mobile, setMobile] = useState(typeof window !== "undefined" ? window.innerWidth < 640 : false);
  useEffect(() => {
    const fn = () => setMobile(window.innerWidth < 640);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return mobile;
}

// ─── ConfirmModal ─────────────────────────────────────────────────────────────
function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div onClick={onCancel}
      style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.5)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:24 }}>
      <div onClick={e=>e.stopPropagation()}
        style={{ background:"#fff",borderRadius:16,padding:28,maxWidth:360,width:"100%",boxShadow:"0 20px 50px rgba(0,0,0,.2)",textAlign:"center" }}>
        <div style={{ fontSize:40,marginBottom:12 }}>🗑️</div>
        <p style={{ margin:"0 0 20px",fontSize:15,color:"#374151",fontFamily:"'DM Sans',sans-serif",lineHeight:1.5 }}>{message}</p>
        <div style={{ display:"flex",gap:10,justifyContent:"center" }}>
          <button onClick={onConfirm}
            style={{ background:"#ef4444",color:"#fff",border:"none",borderRadius:10,padding:"10px 24px",cursor:"pointer",fontSize:14,fontWeight:700,fontFamily:"'DM Sans',sans-serif" }}>
            Delete
          </button>
          <button onClick={onCancel}
            style={{ background:"#f3f4f6",color:"#374151",border:"none",borderRadius:10,padding:"10px 24px",cursor:"pointer",fontSize:14,fontWeight:600,fontFamily:"'DM Sans',sans-serif" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── TagBadge ─────────────────────────────────────────────────────────────────
function TagBadge({ tag, allTags }) {
  const idx = (allTags || []).indexOf(tag) % TAG_COLORS.length;
  return <span style={{ background: TAG_COLORS[idx>=0?idx:0]||"#f3f4f6", color:"#374151", padding:"2px 9px", borderRadius:999, fontSize:11, fontWeight:700, whiteSpace:"nowrap", fontFamily:"'DM Sans',sans-serif" }}>{tag}</span>;
}

// ─── StarRating ───────────────────────────────────────────────────────────────
function StarRating({ value=0, onChange, size=20 }) {
  const [hover, setHover] = useState(0);
  return (
    <div style={{ display:"flex", gap:1 }}>
      {[1,2,3,4,5].map(n => (
        <span key={n} onClick={()=>onChange?.(n)}
          onMouseEnter={()=>onChange&&setHover(n)} onMouseLeave={()=>onChange&&setHover(0)}
          style={{ cursor:onChange?"pointer":"default", fontSize:size, color:n<=(hover||value)?"#f59e0b":"#d1d5db", transition:"color .12s", userSelect:"none" }}>★</span>
      ))}
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function Modal({ title, onClose, children, wide }) {
  const isMobile = useIsMobile();
  useEffect(() => { document.body.style.overflow="hidden"; return ()=>{ document.body.style.overflow=""; }; }, []);
  return (
    <div onClick={e=>e.target===e.currentTarget&&onClose()}
      style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.5)",zIndex:1000,display:"flex",
        alignItems:isMobile?"flex-end":"center",justifyContent:"center",
        padding:isMobile?0:16,backdropFilter:"blur(2px)" }}>
      <div style={{ background:"#fff",width:"100%",maxWidth:wide&&!isMobile?780:540,
        maxHeight:isMobile?"92vh":"90vh",overflowY:"auto",
        borderRadius:isMobile?"20px 20px 0 0":20,boxShadow:"0 25px 60px rgba(0,0,0,.25)" }}>
        {isMobile && <div style={{ width:40,height:4,background:"#d1d5db",borderRadius:2,margin:"12px auto 0" }} />}
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:isMobile?"16px 20px 0":"22px 26px 0" }}>
          <h2 style={{ margin:0,fontSize:isMobile?18:20,fontFamily:"'Playfair Display',serif",color:"#1a1a2e" }}>{title}</h2>
          <button onClick={onClose} style={{ border:"none",background:"#f3f4f6",borderRadius:"50%",width:32,height:32,cursor:"pointer",color:"#6b7280",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center" }}>×</button>
        </div>
        <div style={{ padding:isMobile?"16px 20px 36px":"22px 26px 26px" }}>{children}</div>
      </div>
    </div>
  );
}

// ─── TagPicker ────────────────────────────────────────────────────────────────
function TagPicker({ selected=[], onChange, allTags, onAddTag }) {
  const [newTag, setNewTag] = useState("");
  const [showInput, setShowInput] = useState(false);
  function toggle(t) { onChange(selected.includes(t)?selected.filter(x=>x!==t):[...selected,t]); }
  function addCustom() {
    const t = newTag.trim(); if (!t) return;
    if (!allTags.includes(t)) onAddTag(t);
    if (!selected.includes(t)) onChange([...selected,t]);
    setNewTag(""); setShowInput(false);
  }
  return (
    <div style={{ display:"flex",flexWrap:"wrap",gap:6 }}>
      {allTags.map(t => (
        <button key={t} onClick={()=>toggle(t)} style={{
          border:selected.includes(t)?"2px solid #6366f1":"2px solid #e5e7eb",
          background:selected.includes(t)?"#ede9fe":"#fff",
          borderRadius:999,padding:"5px 12px",fontSize:12,cursor:"pointer",
          fontWeight:600,transition:"all .15s",color:selected.includes(t)?"#4f46e5":"#6b7280",
          fontFamily:"'DM Sans',sans-serif" }}>
          {t}
        </button>
      ))}
      {showInput ? (
        <div style={{ display:"flex",gap:6,alignItems:"center",flexWrap:"wrap" }}>
          <input autoFocus value={newTag} onChange={e=>setNewTag(e.target.value)}
            onKeyDown={e=>{ if(e.key==="Enter")addCustom(); if(e.key==="Escape")setShowInput(false); }}
            style={{ border:"2px solid #6366f1",borderRadius:999,padding:"5px 12px",fontSize:12,outline:"none",fontFamily:"'DM Sans',sans-serif",width:130 }}
            placeholder="New tag name…" />
          <button onClick={addCustom} style={{ background:"#6366f1",color:"#fff",border:"none",borderRadius:999,padding:"5px 14px",fontSize:12,cursor:"pointer",fontWeight:700 }}>Add</button>
          <button onClick={()=>setShowInput(false)} style={{ background:"#f3f4f6",color:"#6b7280",border:"none",borderRadius:999,padding:"5px 10px",fontSize:12,cursor:"pointer" }}>✕</button>
        </div>
      ) : (
        <button onClick={()=>setShowInput(true)} style={{
          border:"2px dashed #d1d5db",background:"#fafafa",borderRadius:999,
          padding:"5px 12px",fontSize:12,cursor:"pointer",color:"#9ca3af",fontWeight:600,fontFamily:"'DM Sans',sans-serif" }}>
          + Custom tag
        </button>
      )}
    </div>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────
const lbl = { display:"block",marginBottom:5,fontSize:13,fontWeight:700,color:"#374151",fontFamily:"'DM Sans',sans-serif" };
const inp = { width:"100%",border:"1.5px solid #e5e7eb",borderRadius:10,padding:"10px 13px",fontSize:14,fontFamily:"'DM Sans',sans-serif",outline:"none",boxSizing:"border-box",color:"#1f2937",transition:"border-color .15s" };
const btnP = { background:"linear-gradient(135deg,#6366f1,#8b5cf6)",color:"#fff",border:"none",borderRadius:10,padding:"11px 20px",cursor:"pointer",fontSize:13,fontFamily:"'DM Sans',sans-serif",fontWeight:700,whiteSpace:"nowrap" };
const btnS = { background:"#f3f4f6",color:"#374151",border:"none",borderRadius:10,padding:"11px 20px",cursor:"pointer",fontSize:13,fontFamily:"'DM Sans',sans-serif",fontWeight:600 };

// ─── RecipeForm ───────────────────────────────────────────────────────────────
function RecipeForm({ initial, onSave, onCancel, allTags, onAddTag }) {
  const [form, setForm] = useState(initial||{name:"",cookingTime:"",sourceUrl:"",instructions:"",tags:[],rating:0});
  const [ingList, setIngList] = useState(initial?.ingredients?.join("\n")||"");
  const isMobile = useIsMobile();
  function set(k,v) { setForm(f=>({...f,[k]:v})); }
  function save() {
    if (!form.name.trim()) { alert("Recipe name is required"); return; }
    onSave({ ...form, ingredients:ingList.split("\n").map(s=>s.trim()).filter(Boolean), id:form.id||genId() });
  }
  return (
    <div style={{ display:"flex",flexDirection:"column",gap:15 }}>
      <div style={{ display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:14 }}>
        <div style={{ gridColumn:isMobile?"1":"1/3" }}>
          <label style={lbl}>Recipe Name *</label>
          <input value={form.name} onChange={e=>set("name",e.target.value)} style={inp} placeholder="e.g. Avocado Toast" />
        </div>
        <div>
          <label style={lbl}>Cooking Time</label>
          <input value={form.cookingTime} onChange={e=>set("cookingTime",e.target.value)} style={inp} placeholder="e.g. 30 min" />
        </div>
        <div>
          <label style={lbl}>Source URL</label>
          <input value={form.sourceUrl} onChange={e=>set("sourceUrl",e.target.value)} style={inp} placeholder="https://…" />
        </div>
      </div>
      <div>
        <label style={lbl}>Ingredients <span style={{ color:"#9ca3af",fontWeight:400 }}>(one per line)</span></label>
        <textarea value={ingList} onChange={e=>setIngList(e.target.value)} style={{ ...inp,height:100,resize:"vertical" }} placeholder={"1 cup flour\n2 large eggs\n1 tsp salt"} />
      </div>
      <div>
        <label style={lbl}>Cooking Instructions</label>
        <textarea value={form.instructions} onChange={e=>set("instructions",e.target.value)} style={{ ...inp,height:110,resize:"vertical" }} placeholder="Describe the steps to prepare this recipe…" />
      </div>
      <div>
        <label style={lbl}>Tags <span style={{ color:"#9ca3af",fontWeight:400 }}>(select or create your own)</span></label>
        <TagPicker selected={form.tags||[]} onChange={v=>set("tags",v)} allTags={allTags} onAddTag={onAddTag} />
      </div>
      <div>
        <label style={lbl}>Your Rating</label>
        <StarRating value={form.rating||0} onChange={v=>set("rating",v)} size={26} />
      </div>
      <div style={{ display:"flex",gap:10,flexWrap:"wrap",paddingTop:4 }}>
        <button onClick={save} style={btnP}>💾 Save Recipe</button>
        <button onClick={onCancel} style={btnS}>Cancel</button>
      </div>
    </div>
  );
}

// ─── RecipeCard ───────────────────────────────────────────────────────────────
function RecipeCard({ recipe, onEdit, onDelete, onRate, onAddToPlan, compact, allTags }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ background:"#fff",borderRadius:16,border:"1.5px solid #f0f0f0",overflow:"hidden",
      boxShadow:"0 2px 8px rgba(0,0,0,.06)",transition:"transform .2s,box-shadow .2s" }}
      onMouseEnter={e=>{ if(window.innerWidth>640){e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 8px 24px rgba(0,0,0,.12)";} }}
      onMouseLeave={e=>{ e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="0 2px 8px rgba(0,0,0,.06)"; }}>
      <div style={{ padding:15 }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8 }}>
          <h3 style={{ margin:0,fontSize:15,fontFamily:"'Playfair Display',serif",color:"#1a1a2e",lineHeight:1.3,flex:1,paddingRight:8 }}>{recipe.name}</h3>
          <div style={{ display:"flex",gap:5,flexShrink:0 }}>
            {onEdit&&<button onClick={e=>{e.stopPropagation();onEdit(recipe);}} style={{ border:"none",background:"#f3f4f6",borderRadius:8,padding:"5px 9px",cursor:"pointer",fontSize:13,lineHeight:1 }}>✏️</button>}
            {onDelete&&<button onClick={e=>{e.stopPropagation();onDelete(recipe.id);}} style={{ border:"none",background:"#fee2e2",borderRadius:8,padding:"5px 9px",cursor:"pointer",fontSize:13,lineHeight:1 }}>🗑</button>}
          </div>
        </div>
        <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:8,flexWrap:"wrap" }}>
          <StarRating value={recipe.rating||0} onChange={onRate?v=>onRate(recipe.id,v):null} size={17} />
          {recipe.cookingTime&&<span style={{ fontSize:12,color:"#9ca3af" }}>⏱ {recipe.cookingTime}</span>}
        </div>
        <div style={{ display:"flex",flexWrap:"wrap",gap:4,marginBottom:compact?10:8 }}>
          {recipe.tags?.map(t=><TagBadge key={t} tag={t} allTags={allTags} />)}
        </div>
        {!compact&&(
          <button onClick={()=>setExpanded(!expanded)} style={{ border:"none",background:"none",color:"#6366f1",fontSize:12,cursor:"pointer",padding:0,fontFamily:"'DM Sans',sans-serif",fontWeight:600 }}>
            {expanded?"▲ Hide details":"▼ Show details"}
          </button>
        )}
        {expanded&&!compact&&(
          <div style={{ marginTop:12,borderTop:"1px solid #f3f4f6",paddingTop:12 }}>
            {recipe.ingredients?.length>0&&<>
              <p style={{ margin:"0 0 6px",fontSize:13,fontWeight:700,color:"#374151" }}>Ingredients</p>
              <ul style={{ margin:"0 0 12px",paddingLeft:18 }}>
                {recipe.ingredients.map((ing,i)=><li key={i} style={{ fontSize:13,color:"#6b7280",marginBottom:2 }}>{ing}</li>)}
              </ul>
            </>}
            {recipe.instructions&&<>
              <p style={{ margin:"0 0 6px",fontSize:13,fontWeight:700,color:"#374151" }}>Instructions</p>
              <p style={{ margin:"0 0 10px",fontSize:13,color:"#6b7280",lineHeight:1.65 }}>{recipe.instructions}</p>
            </>}
            {recipe.sourceUrl&&<a href={recipe.sourceUrl} target="_blank" rel="noreferrer" style={{ fontSize:12,color:"#6366f1",fontWeight:600 }}>🔗 Source</a>}
          </div>
        )}
        {onAddToPlan&&(
          <button onClick={e=>{e.stopPropagation();onAddToPlan(recipe);}}
            style={{ marginTop:10,width:"100%",background:"linear-gradient(135deg,#6366f1,#8b5cf6)",color:"#fff",border:"none",borderRadius:10,padding:"9px 0",cursor:"pointer",fontSize:13,fontFamily:"'DM Sans',sans-serif",fontWeight:700 }}>
            + Add to Plan
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function MealPlanner() {
  const [tab, setTab] = useState("planner");
  const [recipes, setRecipes] = useState([]);
  const [plan, setPlan] = useState({});
  const [customTags, setCustomTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState(null); // recipe id to delete
  const [showAddRecipe, setShowAddRecipe] = useState(false);
  const [showEditRecipe, setShowEditRecipe] = useState(null);
  const [showUrlImport, setShowUrlImport] = useState(false);
  const [showRecommend, setShowRecommend] = useState(false);
  const [showPickRecipe, setShowPickRecipe] = useState(null);
  const [showRecipeDetail, setShowRecipeDetail] = useState(null);

  const [importUrl, setImportUrl] = useState("");
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [recommendContext, setRecommendContext] = useState("");
  const [recommendResult, setRecommendResult] = useState("");
  const [recommendLoading, setRecommendLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDay, setSelectedDay] = useState(0);

  const isMobile = useIsMobile();
  const allTags = [...DEFAULT_TAGS, ...customTags.filter(t=>!DEFAULT_TAGS.includes(t))];

  useEffect(() => {
    (async () => {
      const [r,p,t] = await Promise.all([loadShared(STORAGE_KEYS.RECIPES),loadShared(STORAGE_KEYS.PLAN),loadShared(STORAGE_KEYS.TAGS)]);
      if(r) setRecipes(r); if(p) setPlan(p); if(t) setCustomTags(t);
      setLoading(false);
    })();
  }, []);

  async function persistRecipes(next) { setRecipes(next); setSaving(true); await saveShared(STORAGE_KEYS.RECIPES,next); setSaving(false); }
  async function persistPlan(next) { setPlan(next); setSaving(true); await saveShared(STORAGE_KEYS.PLAN,next); setSaving(false); }
  async function persistTags(next) { setCustomTags(next); await saveShared(STORAGE_KEYS.TAGS,next); }
  function addCustomTag(t) { if(!customTags.includes(t)) persistTags([...customTags,t]); }

  function addRecipe(r) { persistRecipes([...recipes,r]); setShowAddRecipe(false); }
  function editRecipe(r) { persistRecipes(recipes.map(x=>x.id===r.id?r:x)); setShowEditRecipe(null); }
  function deleteRecipe(id) { setConfirmDelete(id); }
  function rateRecipe(id,rating) { persistRecipes(recipes.map(r=>r.id===id?{...r,rating}:r)); }

  const planKey=(d,s)=>`${d}_${s}`;
  const slotRecipes=(d,s)=>(plan[planKey(d,s)]||[]).map(id=>recipes.find(r=>r.id===id)).filter(Boolean);
  function addToPlan(dayIndex,slot,recipe) {
    const k=planKey(dayIndex,slot);
    if((plan[k]||[]).includes(recipe.id))return;
    persistPlan({...plan,[k]:[...(plan[k]||[]),recipe.id]});
    setShowPickRecipe(null);
  }
  function removeFromPlan(dayIndex,slot,recipeId) {
    const k=planKey(dayIndex,slot);
    persistPlan({...plan,[k]:(plan[k]||[]).filter(id=>id!==recipeId)});
  }

  async function handleUrlImport() {
    if(!importUrl.trim())return;
    setImportLoading(true); setImportError(""); setImportStatus("");
    try {
      const r=await parseRecipeFromUrl(importUrl.trim(), setImportStatus);
      persistRecipes([...recipes,{...r,id:genId(),rating:0}]);
      setShowUrlImport(false); setImportUrl(""); setImportStatus("");
    } catch(e) { setImportError(e.message||"Could not extract recipe. Try a different URL."); }
    setImportLoading(false);
  }

  async function handleSheetUpload(e) {
    const file=e.target.files[0]; if(!file)return;
    const text=await file.text();
    const rows=text.split("\n").map(r=>r.split(",").map(c=>c.replace(/"/g,"").trim()));
    const [,...data]=rows;
    const newR=data.filter(r=>r[0]).map(r=>({
      id:genId(),rating:0,name:r[0]||"Unnamed",cookingTime:r[1]||"",
      ingredients:(r[2]||"").split(";").map(s=>s.trim()).filter(Boolean),
      instructions:r[3]||"",tags:(r[4]||"").split(";").map(s=>s.trim()).filter(Boolean),sourceUrl:r[5]||""
    }));
    if(newR.length){persistRecipes([...recipes,...newR]);alert(`Imported ${newR.length} recipe(s)!`);}
    else alert("No recipes found. Expected: Name,CookTime,Ingredients(;sep),Instructions,Tags(;sep),URL");
    e.target.value="";
  }

  async function handleRecommend() {
    setRecommendLoading(true); setRecommendResult("");
    setRecommendResult(await recommendRecipe(recipes,recommendContext));
    setRecommendLoading(false);
  }

  const filteredRecipes=recipes.filter(r=>{
    const q=searchQuery.toLowerCase();
    return !q||r.name.toLowerCase().includes(q)||r.tags?.some(t=>t.toLowerCase().includes(q));
  });

  if(loading) return (
    <div style={{ display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#f8f7ff" }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:52,marginBottom:12 }}>🍽️</div>
        <p style={{ fontFamily:"'Playfair Display',serif",fontSize:20,color:"#6366f1",margin:0 }}>Loading your meal plan…</p>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh",background:"#f8f7ff",fontFamily:"'DM Sans',sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=DM+Sans:wght@400;500;600;700&display=swap');
        *{box-sizing:border-box;}
        input:focus,textarea:focus{border-color:#6366f1!important;box-shadow:0 0 0 3px rgba(99,102,241,.12);}
        ::-webkit-scrollbar{width:5px;height:5px;}::-webkit-scrollbar-thumb{background:#c7c7d4;border-radius:3px;}
        .day-scroll::-webkit-scrollbar{display:none;}
      `}</style>

      {/* Header */}
      <header style={{ background:"#fff",borderBottom:"1px solid #ede9fe",position:"sticky",top:0,zIndex:100,boxShadow:"0 2px 12px rgba(99,102,241,.07)" }}>
        <div style={{ maxWidth:1100,margin:"0 auto",padding:isMobile?"0 14px":"0 24px",display:"flex",alignItems:"center",justifyContent:"space-between",height:isMobile?56:64 }}>
          <div style={{ display:"flex",alignItems:"center",gap:isMobile?8:12 }}>
            <span style={{ fontSize:isMobile?24:28 }}>🍽️</span>
            <div>
              <h1 style={{ margin:0,fontFamily:"'Playfair Display',serif",fontSize:isMobile?16:21,color:"#1a1a2e",lineHeight:1.2 }}>Family Meal Planner</h1>
              {!isMobile&&<p style={{ margin:0,fontSize:11,color:"#9ca3af" }}>Shared household • 10-day plan</p>}
            </div>
          </div>
          <div style={{ display:"flex",alignItems:"center",gap:isMobile?8:10 }}>
            {saving&&!isMobile&&<span style={{ fontSize:12,color:"#9ca3af" }}>💾 Saving…</span>}
            <button onClick={()=>setShowRecommend(true)} style={{ ...btnP,padding:isMobile?"8px 12px":"8px 16px",fontSize:isMobile?12:13 }}>
              {isMobile?"✨":"✨ Recommend"}
            </button>
            <div style={{ display:"flex",background:"#f3f4f6",borderRadius:10,padding:3 }}>
              {[{id:"planner",icon:"📅",label:"Plan"},{id:"library",icon:"📚",label:"Library"}].map(t=>(
                <button key={t.id} onClick={()=>setTab(t.id)} style={{ border:"none",borderRadius:7,padding:isMobile?"6px 10px":"6px 14px",cursor:"pointer",fontSize:isMobile?12:13,fontWeight:700,
                  background:tab===t.id?"#fff":"transparent",color:tab===t.id?"#6366f1":"#9ca3af",
                  boxShadow:tab===t.id?"0 1px 4px rgba(0,0,0,.1)":"none",transition:"all .2s",fontFamily:"'DM Sans',sans-serif" }}>
                  {isMobile?t.icon:`${t.icon} ${t.label}`}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main style={{ maxWidth:1100,margin:"0 auto",padding:isMobile?"16px 14px 80px":"24px 24px 40px" }}>

        {/* PLANNER TAB */}
        {tab==="planner"&&(
          <div>
            <div className="day-scroll" style={{ display:"flex",gap:isMobile?6:8,marginBottom:20,overflowX:"auto",paddingBottom:4 }}>
              {DAYS.map(d=>(
                <button key={d.index} onClick={()=>setSelectedDay(d.index)} style={{
                  flex:"0 0 auto",border:"none",borderRadius:12,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",
                  padding:isMobile?"8px 10px":"10px 16px",minWidth:isMobile?46:undefined,
                  background:selectedDay===d.index?"linear-gradient(135deg,#6366f1,#8b5cf6)":"#fff",
                  color:selectedDay===d.index?"#fff":"#6b7280",
                  boxShadow:selectedDay===d.index?"0 4px 12px rgba(99,102,241,.35)":"0 1px 4px rgba(0,0,0,.08)",
                  transform:selectedDay===d.index?"scale(1.05)":"scale(1)",transition:"all .2s" }}>
                  {isMobile?(
                    <div style={{ textAlign:"center" }}>
                      <div style={{ fontSize:10,fontWeight:700,opacity:.85 }}>{d.short}</div>
                      <div style={{ fontSize:15,fontWeight:700 }}>{d.date}</div>
                    </div>
                  ):(
                    <span style={{ fontSize:12,fontWeight:700 }}>{d.label}</span>
                  )}
                </button>
              ))}
            </div>

            <h2 style={{ margin:"0 0 16px",fontFamily:"'Playfair Display',serif",color:"#1a1a2e",fontSize:isMobile?20:24 }}>
              {DAYS[selectedDay].label}
            </h2>

            <div style={{ display:"flex",flexDirection:"column",gap:12 }}>
              {MEAL_SLOTS.map(slot=>{
                const sRecs=slotRecipes(selectedDay,slot);
                const accent=SLOT_ACCENT[slot];
                return (
                  <div key={slot} style={{ background:"#fff",borderRadius:14,border:`1.5px solid ${SLOT_COLORS[slot]}`,overflow:"hidden",boxShadow:"0 1px 4px rgba(0,0,0,.05)" }}>
                    <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:isMobile?"11px 14px":"13px 18px",background:SLOT_COLORS[slot] }}>
                      <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                        <span style={{ fontSize:isMobile?18:20 }}>{SLOT_ICONS[slot]}</span>
                        <span style={{ fontWeight:700,fontSize:isMobile?13:14,color:accent,fontFamily:"'DM Sans',sans-serif" }}>{slot}</span>
                        {sRecs.length>0&&<span style={{ background:accent,color:"#fff",borderRadius:999,padding:"1px 7px",fontSize:11,fontWeight:700 }}>{sRecs.length}</span>}
                      </div>
                      <button onClick={()=>setShowPickRecipe({dayIndex:selectedDay,slot})}
                        style={{ background:accent,color:"#fff",border:"none",borderRadius:8,padding:isMobile?"6px 12px":"7px 14px",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"'DM Sans',sans-serif" }}>
                        + Add
                      </button>
                    </div>
                    <div style={{ padding:sRecs.length?(isMobile?"10px 14px":"12px 18px"):(isMobile?"14px":"18px"),minHeight:isMobile?48:56 }}>
                      {sRecs.length===0?(
                        <p style={{ margin:0,color:"#d1d5db",fontSize:13,fontStyle:"italic",textAlign:"center" }}>No meal planned — tap Add to get started</p>
                      ):(
                        <div style={{ display:"flex",flexWrap:"wrap",gap:8 }}>
                          {sRecs.map(r=>(
                            <div key={r.id} style={{ display:"flex",alignItems:"center",gap:6,background:"#f5f3ff",borderRadius:10,padding:isMobile?"7px 10px":"8px 12px",border:"1px solid #ddd6fe",maxWidth:"100%" }}>
                              <span onClick={()=>setShowRecipeDetail(r)} style={{ cursor:"pointer",fontSize:13,fontWeight:700,color:"#4f46e5",fontFamily:"'DM Sans',sans-serif",wordBreak:"break-word" }}>{r.name}</span>
                              {!isMobile&&r.cookingTime&&<span style={{ fontSize:11,color:"#a78bfa",whiteSpace:"nowrap" }}>⏱ {r.cookingTime}</span>}
                              <button onClick={()=>removeFromPlan(selectedDay,slot,r.id)}
                                style={{ border:"none",background:"#fee2e2",borderRadius:6,padding:"2px 7px",cursor:"pointer",fontSize:12,color:"#ef4444",flexShrink:0,lineHeight:1.4 }}>✕</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* LIBRARY TAB */}
        {tab==="library"&&(
          <div>
            <div style={{ display:"flex",flexDirection:"column",gap:10,marginBottom:18 }}>
              <input value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} style={{ ...inp,fontSize:14 }} placeholder="🔍  Search by name or tag…" />
              <div style={{ display:"flex",gap:8,flexWrap:"wrap" }}>
                <button onClick={()=>setShowAddRecipe(true)} style={{ ...btnP,flex:isMobile?"1 1 auto":undefined,fontSize:13,padding:"9px 16px" }}>+ New Recipe</button>
                <button onClick={()=>setShowUrlImport(true)} style={{ ...btnS,border:"1.5px solid #ddd6fe",flex:isMobile?"1 1 auto":undefined,fontSize:13,padding:"9px 16px" }}>🔗 From URL</button>
                <label style={{ ...btnS,border:"1.5px solid #ddd6fe",cursor:"pointer",flex:isMobile?"1 1 auto":undefined,fontSize:13,padding:"9px 16px",textAlign:"center" }}>
                  📊 Import CSV
                  <input type="file" accept=".csv" onChange={handleSheetUpload} style={{ display:"none" }} />
                </label>
              </div>
            </div>

            {filteredRecipes.length===0?(
              <div style={{ textAlign:"center",padding:"50px 20px" }}>
                <div style={{ fontSize:56,marginBottom:14 }}>🍳</div>
                <h3 style={{ fontFamily:"'Playfair Display',serif",color:"#1a1a2e",marginBottom:8,fontSize:isMobile?18:22 }}>Your recipe library is empty</h3>
                <p style={{ color:"#9ca3af",fontSize:14,margin:0 }}>Add recipes manually, import from a URL, or upload a CSV</p>
              </div>
            ):(
              <div style={{ display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(auto-fill,minmax(280px,1fr))",gap:14 }}>
                {filteredRecipes.map(r=>(
                  <RecipeCard key={r.id} recipe={r} allTags={allTags}
                    onEdit={setShowEditRecipe} onDelete={deleteRecipe} onRate={rateRecipe}
                    onAddToPlan={()=>setShowPickRecipe({fromLibrary:true,recipe:r})} />
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* MODALS */}

      {showAddRecipe&&(
        <Modal title="New Recipe" onClose={()=>setShowAddRecipe(false)} wide>
          <RecipeForm onSave={addRecipe} onCancel={()=>setShowAddRecipe(false)} allTags={allTags} onAddTag={addCustomTag} />
        </Modal>
      )}
      {showEditRecipe&&(
        <Modal title="Edit Recipe" onClose={()=>setShowEditRecipe(null)} wide>
          <RecipeForm initial={showEditRecipe} onSave={editRecipe} onCancel={()=>setShowEditRecipe(null)} allTags={allTags} onAddTag={addCustomTag} />
        </Modal>
      )}
      {showUrlImport&&(
        <Modal title="🔗 Import from URL" onClose={()=>{setShowUrlImport(false);setImportUrl("");setImportError("");setImportStatus("");}}>
          <p style={{ color:"#6b7280",fontSize:14,margin:"0 0 6px",lineHeight:1.6 }}>Paste any recipe URL. The app will visit the page and extract the real recipe automatically.</p>
          <p style={{ color:"#9ca3af",fontSize:12,margin:"0 0 14px",lineHeight:1.5 }}>Works with AllRecipes, BBC Good Food, NYT Cooking, Serious Eats, and most recipe sites.</p>
          <input value={importUrl} onChange={e=>{setImportUrl(e.target.value);setImportError("");}} onKeyDown={e=>e.key==="Enter"&&handleUrlImport()} style={inp} placeholder="https://www.allrecipes.com/recipe/…" disabled={importLoading} />
          {importLoading&&importStatus&&(
            <div style={{ display:"flex",alignItems:"center",gap:8,marginTop:10,padding:"10px 14px",background:"#f5f3ff",borderRadius:10,border:"1px solid #ddd6fe" }}>
              <span style={{ fontSize:16 }}>⏳</span>
              <span style={{ fontSize:13,color:"#6366f1",fontWeight:600,fontFamily:"'DM Sans',sans-serif" }}>{importStatus}</span>
            </div>
          )}
          {importError&&(
            <div style={{ display:"flex",alignItems:"flex-start",gap:8,marginTop:10,padding:"10px 14px",background:"#fef2f2",borderRadius:10,border:"1px solid #fecaca" }}>
              <span style={{ fontSize:15,flexShrink:0 }}>⚠️</span>
              <span style={{ fontSize:13,color:"#dc2626",lineHeight:1.5,fontFamily:"'DM Sans',sans-serif" }}>{importError}</span>
            </div>
          )}
          <div style={{ display:"flex",gap:10,marginTop:16,flexWrap:"wrap" }}>
            <button onClick={handleUrlImport} disabled={importLoading||!importUrl.trim()} style={{ ...btnP,opacity:(importLoading||!importUrl.trim())?.55:1 }}>
              {importLoading?"⏳ Importing…":"🔗 Import Recipe"}
            </button>
            <button onClick={()=>{setShowUrlImport(false);setImportUrl("");setImportError("");setImportStatus("");}} disabled={importLoading} style={{ ...btnS,opacity:importLoading?.6:1 }}>Cancel</button>
          </div>
        </Modal>
      )}
      {showPickRecipe&&(
        <Modal title={showPickRecipe.fromLibrary?"Add to Plan":`Add to ${showPickRecipe.slot}`} onClose={()=>setShowPickRecipe(null)} wide>
          {showPickRecipe.fromLibrary?(
            <div>
              <p style={{ color:"#6b7280",fontSize:14,margin:"0 0 14px" }}>Choose a day and slot for <strong style={{color:"#1a1a2e"}}>{showPickRecipe.recipe?.name}</strong>:</p>
              <div style={{ display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:10,maxHeight:420,overflowY:"auto" }}>
                {DAYS.map(d=>(
                  <div key={d.index} style={{ border:"1.5px solid #ede9fe",borderRadius:12,overflow:"hidden" }}>
                    <div style={{ background:"linear-gradient(135deg,#f5f3ff,#ede9fe)",padding:"8px 12px",fontWeight:700,fontSize:12,color:"#4f46e5",fontFamily:"'DM Sans',sans-serif" }}>{d.label}</div>
                    {MEAL_SLOTS.map(s=>(
                      <button key={s} onClick={()=>addToPlan(d.index,s,showPickRecipe.recipe)}
                        style={{ display:"block",width:"100%",border:"none",borderBottom:"1px solid #f5f3ff",background:"#fff",padding:"9px 12px",cursor:"pointer",fontSize:13,textAlign:"left",color:"#374151",fontFamily:"'DM Sans',sans-serif",transition:"background .12s" }}
                        onMouseEnter={e=>e.currentTarget.style.background="#f5f3ff"}
                        onMouseLeave={e=>e.currentTarget.style.background="#fff"}>
                        {SLOT_ICONS[s]} {s}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ):(
            <div>
              <input value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} style={{ ...inp,marginBottom:14 }} placeholder="🔍 Search recipes…" />
              {filteredRecipes.length===0?(
                <p style={{ textAlign:"center",color:"#9ca3af",padding:"20px 0" }}>No recipes found. Add some to your library first!</p>
              ):(
                <div style={{ display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(auto-fill,minmax(230px,1fr))",gap:12,maxHeight:440,overflowY:"auto" }}>
                  {filteredRecipes.map(r=>(
                    <RecipeCard key={r.id} recipe={r} compact allTags={allTags}
                      onAddToPlan={()=>addToPlan(showPickRecipe.dayIndex,showPickRecipe.slot,r)} />
                  ))}
                </div>
              )}
            </div>
          )}
        </Modal>
      )}
      {showRecipeDetail&&(
        <Modal title={showRecipeDetail.name} onClose={()=>setShowRecipeDetail(null)} wide>
          <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:14,flexWrap:"wrap" }}>
            <StarRating value={showRecipeDetail.rating||0} onChange={v=>{rateRecipe(showRecipeDetail.id,v);setShowRecipeDetail({...showRecipeDetail,rating:v});}} size={22} />
            {showRecipeDetail.cookingTime&&<span style={{ color:"#9ca3af",fontSize:14 }}>⏱ {showRecipeDetail.cookingTime}</span>}
          </div>
          <div style={{ display:"flex",flexWrap:"wrap",gap:5,marginBottom:16 }}>
            {showRecipeDetail.tags?.map(t=><TagBadge key={t} tag={t} allTags={allTags} />)}
          </div>
          {showRecipeDetail.ingredients?.length>0&&<>
            <h4 style={{ margin:"0 0 8px",color:"#374151",fontFamily:"'Playfair Display',serif" }}>Ingredients</h4>
            <ul style={{ marginBottom:16,paddingLeft:20 }}>
              {showRecipeDetail.ingredients.map((ing,i)=><li key={i} style={{ marginBottom:4,color:"#6b7280",fontSize:14 }}>{ing}</li>)}
            </ul>
          </>}
          {showRecipeDetail.instructions&&<>
            <h4 style={{ margin:"0 0 8px",color:"#374151",fontFamily:"'Playfair Display',serif" }}>Instructions</h4>
            <p style={{ color:"#6b7280",lineHeight:1.7,fontSize:14,marginBottom:16 }}>{showRecipeDetail.instructions}</p>
          </>}
          {showRecipeDetail.sourceUrl&&<a href={showRecipeDetail.sourceUrl} target="_blank" rel="noreferrer" style={{ color:"#6366f1",fontSize:14,fontWeight:600 }}>🔗 View original source</a>}
        </Modal>
      )}
      {showRecommend&&(
        <Modal title="✨ Get a Recommendation" onClose={()=>{setShowRecommend(false);setRecommendResult("");setRecommendContext("");}}>
          <p style={{ color:"#6b7280",fontSize:14,margin:"0 0 12px",lineHeight:1.6 }}>Tell us what you're in the mood for, or leave blank for a surprise:</p>
          <input value={recommendContext} onChange={e=>setRecommendContext(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleRecommend()} style={inp} placeholder="e.g. something quick, healthy dinner, kid-friendly…" />
          <button onClick={handleRecommend} disabled={recommendLoading} style={{ ...btnP,marginTop:14,opacity:recommendLoading?.6:1,width:"100%" }}>
            {recommendLoading?"⏳ Finding the perfect meal…":"✨ Recommend Recipes"}
          </button>
          {recommendResult&&(
            <div style={{ marginTop:16,background:"#f5f3ff",borderRadius:14,padding:16,border:"1px solid #ddd6fe" }}>
              <p style={{ margin:0,fontSize:14,color:"#374151",lineHeight:1.75,whiteSpace:"pre-wrap" }}>{recommendResult}</p>
            </div>
          )}
        </Modal>
      )}
      {confirmDelete&&(
        <ConfirmModal
          message="Are you sure you want to delete this recipe? This cannot be undone."
          onConfirm={()=>{ persistRecipes(recipes.filter(r=>r.id!==confirmDelete)); setConfirmDelete(null); }}
          onCancel={()=>setConfirmDelete(null)} />
      )}
    </div>
  );
}
