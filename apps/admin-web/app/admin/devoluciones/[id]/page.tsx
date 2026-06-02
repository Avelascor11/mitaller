'use client';

import { use, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

/* ─── Constants ──────────────────────────────────────────── */
const API   = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const G     = '#34B27B';
const G2    = '#2A9D8F';
const FONT  = "Inter,-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif";
const E4: [number,number,number,number] = [0.22,1,0.36,1];
const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")";

const SM: Record<string,{label:string;fg:string;bg:string;dot:string}> = {
  REQUESTED:     {label:'En espera',        fg:'#f0b429',bg:'rgba(240,180,41,0.13)', dot:'#f0b429'},
  LABEL_CREATED: {label:'Etiqueta enviada', fg:'#5b9bd5',bg:'rgba(91,155,213,0.13)', dot:'#5b9bd5'},
  RECEIVED:      {label:'Por revisar',      fg:'#9b8cdb',bg:'rgba(155,140,219,0.13)',dot:'#9b8cdb'},
  APPROVED:      {label:'Aprobada',         fg:'#3fb98a',bg:'rgba(63,185,138,0.13)', dot:'#3fb98a'},
  REJECTED:      {label:'Rechazada',        fg:'#e06a6a',bg:'rgba(224,106,106,0.13)',dot:'#e06a6a'},
  CANCELLED:     {label:'Cancelada',        fg:'#8A8A96',bg:'rgba(138,138,150,0.13)',dot:'#8A8A96'},
};

const RL: Record<string,string> = {
  WRONG_SIZE:'Talla incorrecta', DEFECTIVE:'Defectuoso',
  NOT_AS_DESCRIBED:'No coincide con descripción', CHANGED_MIND:'Cambio de opinión',
  WRONG_ITEM:'Artículo incorrecto', OTHER:'Otro motivo',
};

/* ─── Theme ──────────────────────────────────────────────── */
function th(d:boolean) {
  return d
    ? {d:true,  tx:'#ECECEF',t2:'#B4B4BE',dim:'#7C7C88',faint:'#56565F',
       card:'rgba(255,255,255,0.028)',bg:'#08080B',
       border:'rgba(255,255,255,0.08)',bs:'rgba(255,255,255,0.05)',
       head:'rgba(255,255,255,0.025)',hov:'rgba(255,255,255,0.04)',
       inp:'rgba(255,255,255,0.05)',
       shadow:'0 1px 0 rgba(255,255,255,0.06) inset,0 20px 40px -14px rgba(0,0,0,.7)',
       nav:'rgba(8,8,11,0.85)'}
    : {d:false, tx:'#15171C',t2:'#3C4049',dim:'#6B7280',faint:'#9AA0AA',
       card:'rgba(255,255,255,0.92)',bg:'#EEF0F3',
       border:'rgba(20,22,28,0.08)',bs:'rgba(20,22,28,0.05)',
       head:'rgba(20,22,28,0.025)',hov:'rgba(20,22,28,0.03)',
       inp:'#FFFFFF',
       shadow:'0 1px 0 rgba(255,255,255,0.9) inset,0 16px 36px -14px rgba(20,22,28,.18)',
       nav:'rgba(238,240,243,0.88)'};
}

/* ─── Types ──────────────────────────────────────────────── */
interface Ret {
  id:string; shopifyOrderNumber:string; customerName:string; customerEmail:string;
  status:string; type:string; paymentStatus:string;
  checkoutUrl?:string|null; labelUrl?:string|null;
  trackingNumber?:string|null; carrier?:string|null; notes?:string|null;
  totalAmount?:number|null; refundAmount?:number|null;
  createdAt:string; updatedAt?:string; receivedAt?:string|null;
  verifiedAt?:string|null; verificationStatus?:string|null; verificationNotes?:string|null;
  refundedAt?:string|null; shopifyRefundAmount?:number|null;
  order:{
    orderNumber:string; customerName:string; customerEmail?:string|null;
    customerPhone?:string|null; shippingAddressJson?:unknown;
    totalPrice?:number|null; createdAt?:string;
  };
  items:Array<{
    id:string; quantity:number; reason:string; notes?:string|null;
    replacementTitle?:string|null; replacementPrice?:number|null;
    orderItem:{title:string; variantTitle?:string|null; sku:string; imageUrl?:string|null; price?:number|null};
  }>;
}

/* ─── Toast ──────────────────────────────────────────────── */
function useToast() {
  const [list,set] = useState<{id:number;msg:string;ok:boolean}[]>([]);
  const n = useRef(0);
  const push = (msg:string,ok=true) => {
    const id=++n.current; set(t=>[...t,{id,msg,ok}]);
    setTimeout(()=>set(t=>t.filter(x=>x.id!==id)),3400);
  };
  return {list, ok:(m:string)=>push(m,true), err:(m:string)=>push(m,false)};
}

/* ─── Address ────────────────────────────────────────────── */
function addr(v:unknown):string {
  if(!v) return '—';
  let a=v;
  if(typeof v==='string'){try{a=JSON.parse(v)}catch{return v}}
  if(!a||typeof a!=='object') return String(a);
  const o=a as Record<string,unknown>;
  return [o.address1,o.address2,o.city,o.province,o.zip,o.country??o.countryCodeV2]
    .filter((p):p is string=>typeof p==='string'&&!!p).join(', ')||'—';
}

/* ─── SVG Icon ───────────────────────────────────────────── */
const IC = {
  back:    'M19 12H5|M12 5l-7 7 7 7',
  check:   'M20 6L9 17l-5-5',
  x:       'M18 6L6 18|M6 6l12 12',
  refresh: 'M23 4v6h-6|M1 20v-6h6|M3.51 9a9 9 0 0 1 14.85-3.36L23 10|M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
  down:    'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|M7 10l5 5 5-5|M12 15V3',
  tag:     'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z|M7 7h.01',
  cam:     'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z|M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  sun:     'M12 1v2|M12 21v2|M4.22 4.22l1.42 1.42|M18.36 18.36l1.42 1.42|M1 12h2|M21 12h2|M4.22 19.78l1.42-1.42|M18.36 5.64l1.42-1.42|M12 5a7 7 0 1 0 0 14A7 7 0 0 0 12 5z',
  moon:    'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
};
function Ic({d,s=16,c,w=1.75}:{d:string;s?:number;c:string;w?:number}){
  return(
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round">
      {d.split('|').map((p,i)=><path key={i} d={p}/>)}
    </svg>
  );
}

/* ─── Variants ───────────────────────────────────────────── */
const vPage   = {hidden:{opacity:0},show:{opacity:1,transition:{staggerChildren:0.06}}};
const vCard   = {hidden:{opacity:0,y:22},show:{opacity:1,y:0,transition:{duration:.34,ease:E4}}};
const vSide   = {hidden:{opacity:0,x:20},show:{opacity:1,x:0,transition:{duration:.32,ease:E4}}};
const vRow    = (i:number) => ({hidden:{opacity:0,x:-12},show:{opacity:1,x:0,transition:{delay:i*.08+.15,duration:.26,ease:E4}}});
const vDot    = (i:number) => ({hidden:{scale:.5,opacity:0},show:{scale:1,opacity:1,transition:{delay:i*.1+.25,type:'spring' as const,damping:16,stiffness:260}}});
const vPill   = {hidden:{opacity:0,scale:.82,y:6},show:{opacity:1,scale:1,y:0,transition:{type:'spring' as const,damping:18,stiffness:320}}};
const vModal  = {hidden:{opacity:0,scale:.93,y:14},show:{opacity:1,scale:1,y:0,transition:{type:'spring' as const,damping:22,stiffness:310}}};
const vToast  = {hidden:{opacity:0,x:44,scale:.9},show:{opacity:1,x:0,scale:1,transition:{type:'spring' as const,damping:20,stiffness:300}},exit:{opacity:0,x:44,scale:.9,transition:{duration:.18}}};

/* ══════════════════════════════════════════════════════════ */
export default function Page({params}:{params:Promise<{id:string}>}) {
  const {id}   = use(params);
  const [dark, setDark]         = useState(true);
  const [tok,  setTok]          = useState('');
  const [data, setData]         = useState<Ret|null>(null);
  const [busy, setBusy]         = useState(true);
  const [gone, setGone]         = useState(false);
  const [act,  setAct]          = useState(false);
  const [vnotes,setVnotes]      = useState('');
  const [photos,setPhotos]      = useState<string[]>([]);
  const [uploading,setUploading]= useState(false);
  const {list:toasts,ok,err}    = useToast();

  const T = th(dark);
  const mesh = dark
    ? 'radial-gradient(900px 500px at 10% -5%,rgba(52,178,123,.11),transparent 60%),radial-gradient(700px 600px at 95% 5%,rgba(91,120,213,.08),transparent 55%)'
    : 'radial-gradient(900px 500px at 10% -5%,rgba(52,178,123,.13),transparent 60%),radial-gradient(700px 600px at 95% 5%,rgba(91,120,213,.10),transparent 55%)';

  useEffect(()=>{
    const saved=localStorage.getItem('admin-theme');
    if(saved) setDark(saved==='dark');
    const t=localStorage.getItem('token')||localStorage.getItem('mitaller_token');
    if(!t){window.location.href='/login';return;}
    setTok(t); load(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[id]);

  useEffect(()=>{localStorage.setItem('admin-theme',dark?'dark':'light');},[dark]);

  const H = (t:string)=>({Authorization:`Bearer ${t}`});

  async function load(t:string){
    setBusy(true);
    try{
      const r=await fetch(`${API}/returns/${id}`,{headers:H(t)});
      if(r.status===401){window.location.href='/login';return;}
      if(r.status===404){setGone(true);return;}
      const d=await r.json(); setData(d);
      // load photos
      const pr=await fetch(`${API}/returns/${id}/photos`,{headers:H(t)});
      if(pr.ok) setPhotos((await pr.json()).map((p:{data:string})=>p.data));
    }catch{setGone(true);}
    finally{setBusy(false);}
  }

  async function upStatus(status:string){
    if(!data) return; setAct(true);
    try{
      if(status==='LABEL_CREATED'){
        const r=await fetch(`${API}/returns/${data.id}/generate-label`,{method:'POST',headers:{'Content-Type':'application/json',...H(tok)}});
        const d=await r.json(); if(!r.ok) throw new Error(d.message??'Error'); ok('Etiqueta generada ✓');
      } else if(status==='RECEIVED'){
        const r=await fetch(`${API}/returns/${data.id}/received`,{method:'PATCH',headers:{'Content-Type':'application/json',...H(tok)}});
        if(!r.ok) throw new Error((await r.json()).message??'Error'); ok('Marcada como recibida ✓');
      } else {
        const r=await fetch(`${API}/returns/${data.id}/status`,{method:'PATCH',headers:{'Content-Type':'application/json',...H(tok)},body:JSON.stringify({status})});
        if(!r.ok) throw new Error((await r.json()).message??'Error'); ok(`Estado → ${SM[status]?.label??status} ✓`);
      }
      load(tok);
    }catch(e){err(e instanceof Error?e.message:'Error');}
    finally{setAct(false);}
  }

  async function verify(vs:'OK'|'ISSUE'){
    if(!data) return; setAct(true);
    try{
      const r=await fetch(`${API}/returns/${data.id}/verify`,{method:'PATCH',headers:{'Content-Type':'application/json',...H(tok)},body:JSON.stringify({verificationStatus:vs,verificationNotes:vnotes||undefined})});
      if(!r.ok) throw new Error('Error');
      ok(vs==='OK'?'Verificación correcta ✓':'Incidencia registrada'); load(tok);
    }catch(e){err(e instanceof Error?e.message:'Error');}
    finally{setAct(false);}
  }

  async function addPhoto(e:React.ChangeEvent<HTMLInputElement>){
    const f=e.target.files?.[0]; if(!f) return; setUploading(true);
    const reader=new FileReader();
    reader.onload=async()=>{
      const d=reader.result as string;
      await fetch(`${API}/returns/${id}/photos`,{method:'POST',headers:{'Content-Type':'application/json',...H(tok)},body:JSON.stringify({data:d})});
      setPhotos(p=>[...p,d]); setUploading(false);
    };
    reader.readAsDataURL(f);
  }

  /* ── shared styles ── */
  const inp:React.CSSProperties={padding:'9px 13px',borderRadius:9,border:`1px solid ${T.border}`,fontSize:13,color:T.tx,background:T.inp,outline:'none',width:'100%',fontFamily:FONT};

  /* ── loading ── */
  if(busy) return(
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:T.bg,fontFamily:FONT}}>
      <motion.div animate={{rotate:360}} transition={{duration:.8,repeat:Infinity,ease:'linear'}}
        style={{width:34,height:34,borderRadius:'50%',border:`3px solid ${T.border}`,borderTopColor:G}}/>
    </div>
  );

  /* ── not found ── */
  if(gone) return(
    <div style={{minHeight:'100vh',background:T.bg,fontFamily:FONT,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:16}}>
      <div style={{position:'fixed',inset:0,backgroundImage:mesh,pointerEvents:'none'}}/>
      <div style={{fontSize:48}}>🔍</div>
      <p style={{fontSize:17,fontWeight:700,color:T.tx,margin:0}}>Devolución no encontrada</p>
      <motion.button whileHover={{y:-2}} whileTap={{scale:.97}}
        onClick={()=>window.location.href='/admin/devoluciones'}
        style={{display:'flex',alignItems:'center',gap:7,padding:'9px 16px',background:T.card,border:`1px solid ${T.border}`,borderRadius:9,color:T.dim,fontSize:13,fontWeight:500,cursor:'pointer',fontFamily:FONT,backdropFilter:'blur(12px)'}}>
        <Ic d={IC.back} s={14} c={T.dim}/> Volver
      </motion.button>
    </div>
  );

  if(!data||!tok) return null;

  const sm  = SM[data.status]??{label:data.status,fg:T.dim,bg:T.head,dot:T.faint};
  const ref = data.shopifyRefundAmount??data.refundAmount??data.totalAmount;

  /* ══════════════════════════════════════════════════════ */
  return(
    <div style={{minHeight:'100vh',background:T.bg,fontFamily:FONT,color:T.tx,transition:'background .4s,color .3s'}}>

      {/* ── style overrides ── */}
      <style>{`
        *{box-sizing:border-box}
        input:focus,select:focus,textarea:focus{border-color:${G}88!important;box-shadow:0 0 0 3px ${G}1f!important;outline:none}
        ::placeholder{color:${T.faint}}
        a{transition:opacity .15s}
        button{transition:filter .15s}
        button:hover{filter:brightness(1.06)}
        button:active{transform:scale(.96)}
      `}</style>

      {/* ── BG layers ── */}
      <div style={{position:'fixed',inset:0,backgroundImage:mesh,pointerEvents:'none',zIndex:0}}/>
      <div style={{position:'fixed',inset:0,backgroundImage:GRAIN,opacity:dark?.045:.03,mixBlendMode:dark?'screen':'multiply',pointerEvents:'none',zIndex:0}}/>
      <div style={{position:'fixed',inset:0,backgroundImage:`linear-gradient(${dark?'rgba(255,255,255,0.016)':'rgba(20,22,28,0.018)'} 1px,transparent 1px),linear-gradient(90deg,${dark?'rgba(255,255,255,0.016)':'rgba(20,22,28,0.018)'} 1px,transparent 1px)`,backgroundSize:'44px 44px',pointerEvents:'none',zIndex:0}}/>

      {/* ── TOASTS ── */}
      <div style={{position:'fixed',bottom:22,right:22,display:'flex',flexDirection:'column',gap:8,zIndex:999}}>
        <AnimatePresence>
          {toasts.map(t=>(
            <motion.div key={t.id} variants={vToast} initial="hidden" animate="show" exit="exit"
              style={{padding:'11px 17px',borderRadius:11,fontSize:13.5,fontWeight:600,background:t.ok?`linear-gradient(140deg,${G},${G2})`:'#e06a6a',color:'#fff',boxShadow:'0 8px 24px rgba(0,0,0,.28)'}}>
              {t.msg}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* ══ NAV BAR ══════════════════════════════════════════ */}
      <motion.header
        initial={{opacity:0,y:-12}} animate={{opacity:1,y:0}} transition={{duration:.3,ease:E4}}
        style={{position:'sticky',top:0,zIndex:50,height:58,display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 24px',background:T.nav,backdropFilter:'blur(22px)',WebkitBackdropFilter:'blur(22px)',borderBottom:`1px solid ${T.border}`}}>

        {/* left */}
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          {/* logo mark */}
          <div style={{width:28,height:28,borderRadius:8,background:`linear-gradient(140deg,${G},${G2})`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:800,color:'#fff',boxShadow:`0 4px 12px -3px ${G}88`}}>S</div>

          <div style={{width:1,height:18,background:T.border}}/>

          <motion.button whileHover={{x:-3,color:G}} whileTap={{scale:.96}}
            onClick={()=>window.location.href='/admin/devoluciones'}
            style={{display:'flex',alignItems:'center',gap:6,fontSize:13,color:T.dim,background:'none',border:'none',cursor:'pointer',fontFamily:FONT,padding:0}}>
            <Ic d={IC.back} s={14} c={T.dim}/>
            <span>Devoluciones</span>
          </motion.button>

          <div style={{width:1,height:18,background:T.border}}/>

          {/* order + status */}
          <div style={{display:'flex',alignItems:'center',gap:9}}>
            <span style={{fontSize:15,fontWeight:750,letterSpacing:'-.02em',color:T.tx,fontVariantNumeric:'tabular-nums'}}>{data.shopifyOrderNumber}</span>

            <AnimatePresence mode="wait">
              <motion.span key={data.status} variants={vPill} initial="hidden" animate="show" exit="hidden"
                style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:12,fontWeight:650,padding:'4px 12px',borderRadius:100,color:sm.fg,background:sm.bg,border:`1px solid ${sm.dot}33`}}>
                <motion.span animate={{opacity:[1,.4,1]}} transition={{duration:2,repeat:Infinity,ease:'easeInOut'}}
                  style={{width:6,height:6,borderRadius:'50%',background:sm.dot,boxShadow:`0 0 7px ${sm.dot}cc`}}/>
                {sm.label}
              </motion.span>
            </AnimatePresence>

            <span style={{fontSize:11.5,fontWeight:600,padding:'3px 9px',borderRadius:7,background:data.type==='EXCHANGE'?'rgba(155,140,219,0.15)':'rgba(91,155,213,0.15)',color:data.type==='EXCHANGE'?'#9b8cdb':'#5b9bd5'}}>
              {data.type==='EXCHANGE'?'⇄ Cambio':'↩ Devolución'}
            </span>
          </div>
        </div>

        {/* right actions */}
        <div style={{display:'flex',gap:7,alignItems:'center'}}>
          {data.status!=='APPROVED'&&data.status!=='REJECTED'&&data.status!=='CANCELLED'&&(
            <motion.button whileHover={{y:-2,boxShadow:`0 10px 22px -8px ${G}99`}} whileTap={{scale:.95}}
              disabled={act} onClick={()=>upStatus('APPROVED')}
              style={{display:'flex',alignItems:'center',gap:7,padding:'8px 15px',background:`linear-gradient(140deg,${G},${G2})`,color:'#fff',border:'none',borderRadius:9,fontSize:13,fontWeight:600,cursor:'pointer',opacity:act?.5:1,fontFamily:FONT,boxShadow:`0 5px 14px -5px ${G}88`}}>
              <Ic d={IC.check} s={14} c="#fff"/> Aprobar
            </motion.button>
          )}
          {data.status!=='REJECTED'&&data.status!=='CANCELLED'&&data.status!=='APPROVED'&&(
            <motion.button whileHover={{y:-2}} whileTap={{scale:.95}}
              disabled={act} onClick={()=>upStatus('REJECTED')}
              style={{display:'flex',alignItems:'center',gap:7,padding:'8px 14px',background:'rgba(224,106,106,0.1)',color:'#e06a6a',border:'1px solid rgba(224,106,106,0.3)',borderRadius:9,fontSize:13,fontWeight:600,cursor:'pointer',opacity:act?.5:1,fontFamily:FONT}}>
              <Ic d={IC.x} s={14} c="#e06a6a"/> Rechazar
            </motion.button>
          )}
          <motion.button whileHover={{rotate:180}} transition={{duration:.4}}
            onClick={()=>load(tok)}
            style={{width:35,height:35,borderRadius:9,background:T.card,border:`1px solid ${T.border}`,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',backdropFilter:'blur(12px)'}}>
            <Ic d={IC.refresh} s={14} c={T.dim}/>
          </motion.button>
          <motion.button whileTap={{scale:.95}} onClick={()=>setDark(d=>!d)}
            style={{width:35,height:35,borderRadius:9,background:T.card,border:`1px solid ${T.border}`,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',backdropFilter:'blur(12px)'}}>
            <Ic d={dark?IC.sun:IC.moon} s={14} c={T.dim}/>
          </motion.button>
        </div>
      </motion.header>

      {/* ══ BODY ════════════════════════════════════════════ */}
      <motion.div variants={vPage} initial="hidden" animate="show"
        style={{position:'relative',zIndex:2,maxWidth:1200,margin:'0 auto',padding:'22px 24px',display:'grid',gridTemplateColumns:'1fr 290px',gap:18,alignItems:'start'}}>

        {/* ── LEFT ── */}
        <div style={{display:'flex',flexDirection:'column',gap:16}}>

          {/* ARTÍCULOS */}
          <motion.div variants={vCard}>
            <div style={{borderRadius:16,background:T.card,border:`1px solid ${T.border}`,boxShadow:T.shadow,backdropFilter:'blur(16px)',overflow:'hidden'}}>
              {/* header */}
              <div style={{padding:'13px 20px',borderBottom:`1px solid ${T.border}`,display:'flex',alignItems:'center',gap:9}}>
                <span style={{fontSize:16}}>📦</span>
                <span style={{fontSize:11.5,fontWeight:700,color:T.faint,letterSpacing:'.07em',textTransform:'uppercase'}}>Artículos solicitados</span>
                <span style={{marginLeft:'auto',fontSize:11.5,fontWeight:600,color:G,background:'rgba(52,178,123,.12)',padding:'2px 8px',borderRadius:100}}>{data.items.length} art.</span>
              </div>
              {/* items */}
              {data.items.map((item,i)=>(
                <motion.div key={item.id} variants={vRow(i)} initial="hidden" animate="show"
                  style={{display:'flex',alignItems:'flex-start',gap:14,padding:'14px 20px',borderBottom:i<data.items.length-1?`1px solid ${T.bs}`:'none'}}>
                  {item.orderItem.imageUrl
                    ? <motion.img whileHover={{scale:1.07}} src={item.orderItem.imageUrl} alt=""
                        style={{width:60,height:60,objectFit:'cover',borderRadius:11,border:`1px solid ${T.border}`,flexShrink:0,cursor:'pointer'}}/>
                    : <div style={{width:60,height:60,borderRadius:11,background:T.head,border:`1px solid ${T.border}`,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:22}}>📷</div>
                  }
                  <div style={{flex:1}}>
                    <div style={{fontSize:14,fontWeight:600,color:T.tx,lineHeight:1.3}}>
                      {item.orderItem.title}
                      {item.orderItem.variantTitle&&<span style={{color:T.dim,fontWeight:400}}> — {item.orderItem.variantTitle}</span>}
                    </div>
                    <div style={{fontSize:11.5,color:T.faint,marginTop:3}}>SKU: {item.orderItem.sku}</div>
                    <div style={{display:'flex',gap:6,marginTop:8,flexWrap:'wrap'}}>
                      <span style={{fontSize:11.5,fontWeight:600,padding:'3px 9px',borderRadius:8,background:T.head,color:T.dim}}>{RL[item.reason]??item.reason}</span>
                      {item.replacementTitle&&<span style={{fontSize:11.5,fontWeight:600,padding:'3px 9px',borderRadius:8,background:'rgba(155,140,219,.13)',color:'#9b8cdb'}}>→ {item.replacementTitle}{item.replacementPrice!=null?` (${item.replacementPrice.toFixed(2)}€)`:''}</span>}
                    </div>
                    {item.notes&&<div style={{fontSize:12,color:T.faint,marginTop:5,fontStyle:'italic'}}>"{item.notes}"</div>}
                  </div>
                  <div style={{textAlign:'right',flexShrink:0}}>
                    <div style={{fontSize:15,fontWeight:750,color:T.tx}}>×{item.quantity}</div>
                    {item.orderItem.price!=null&&<div style={{fontSize:12,color:T.faint,marginTop:2}}>{item.orderItem.price.toFixed(2)}€</div>}
                  </div>
                </motion.div>
              ))}
              {data.notes&&(
                <div style={{padding:'11px 20px',background:'rgba(240,180,41,.07)',borderTop:`1px solid rgba(240,180,41,.2)`}}>
                  <span style={{fontSize:12,color:'#f0b429'}}>💬 </span>
                  <span style={{fontSize:13,color:T.t2}}>{data.notes}</span>
                </div>
              )}
            </div>
          </motion.div>

          {/* VERIFICACIÓN */}
          <motion.div variants={vCard}>
            <div style={{borderRadius:16,background:T.card,border:`1px solid ${T.border}`,boxShadow:T.shadow,backdropFilter:'blur(16px)',overflow:'hidden'}}>
              <div style={{padding:'13px 20px',borderBottom:`1px solid ${T.border}`,display:'flex',alignItems:'center',gap:9}}>
                <span style={{fontSize:16}}>🔍</span>
                <span style={{fontSize:11.5,fontWeight:700,color:T.faint,letterSpacing:'.07em',textTransform:'uppercase'}}>Verificación del paquete</span>
              </div>
              <div style={{padding:'16px 20px'}}>
                <AnimatePresence mode="wait">
                  {data.verificationStatus?(
                    <motion.div key="done" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}} transition={{duration:.22}}>
                      <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                        <span style={{fontSize:13,fontWeight:700,padding:'5px 14px',borderRadius:100,background:data.verificationStatus==='OK'?'rgba(63,185,138,.14)':'rgba(224,106,106,.14)',color:data.verificationStatus==='OK'?'#3fb98a':'#e06a6a'}}>
                          {data.verificationStatus==='OK'?'✅ Todo correcto':'⚠️ Incidencia detectada'}
                        </span>
                        {data.verifiedAt&&<span style={{fontSize:12,color:T.faint}}>{new Date(data.verifiedAt).toLocaleString('es-ES',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</span>}
                      </div>
                      {data.verificationNotes&&<div style={{fontSize:13,color:T.t2,padding:'10px 14px',background:T.head,borderRadius:9,marginTop:10}}>{data.verificationNotes}</div>}
                    </motion.div>
                  ):data.status==='RECEIVED'?(
                    <motion.div key="form" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}} transition={{duration:.22}}>
                      <p style={{margin:'0 0 12px',fontSize:13,color:T.t2}}>Paquete recibido. ¿El contenido es correcto?</p>
                      <input type="text" placeholder="Notas de verificación (opcional)" value={vnotes} onChange={e=>setVnotes(e.target.value)} style={{...inp,marginBottom:10}}/>
                      <div style={{display:'flex',gap:8}}>
                        <motion.button whileHover={{y:-2}} whileTap={{scale:.97}} onClick={()=>verify('OK')} disabled={act}
                          style={{flex:1,padding:'10px',fontSize:13,fontWeight:600,background:'rgba(63,185,138,.12)',color:'#3fb98a',border:'1px solid rgba(63,185,138,.3)',borderRadius:9,cursor:'pointer',opacity:act?.5:1,fontFamily:FONT}}>
                          ✅ Todo correcto
                        </motion.button>
                        <motion.button whileHover={{y:-2}} whileTap={{scale:.97}} onClick={()=>verify('ISSUE')} disabled={act}
                          style={{flex:1,padding:'10px',fontSize:13,fontWeight:600,background:'rgba(224,106,106,.10)',color:'#e06a6a',border:'1px solid rgba(224,106,106,.3)',borderRadius:9,cursor:'pointer',opacity:act?.5:1,fontFamily:FONT}}>
                          ⚠️ Hay incidencia
                        </motion.button>
                      </div>
                    </motion.div>
                  ):(
                    <motion.div key="wait" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
                      style={{fontSize:13,color:T.faint,display:'flex',alignItems:'center',gap:8}}>
                      <span style={{fontSize:18}}>⏳</span>
                      {data.receivedAt?`Recibido el ${new Date(data.receivedAt).toLocaleDateString('es-ES',{day:'2-digit',month:'long',year:'numeric'})}`:'Pendiente de recibir el paquete'}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>

          {/* FOTOS */}
          <motion.div variants={vCard}>
            <div style={{borderRadius:16,background:T.card,border:`1px solid ${T.border}`,boxShadow:T.shadow,backdropFilter:'blur(16px)',overflow:'hidden'}}>
              <div style={{padding:'13px 20px',borderBottom:`1px solid ${T.border}`,display:'flex',alignItems:'center',gap:9}}>
                <span style={{fontSize:16}}>📸</span>
                <span style={{fontSize:11.5,fontWeight:700,color:T.faint,letterSpacing:'.07em',textTransform:'uppercase'}}>Evidencia fotográfica</span>
                {photos.length>0&&<span style={{marginLeft:'auto',fontSize:11.5,fontWeight:600,color:T.dim,background:T.head,padding:'2px 8px',borderRadius:100}}>{photos.length}</span>}
              </div>
              <div style={{padding:'16px 20px'}}>
                <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:photos.length>0?12:0}}>
                  <AnimatePresence>
                    {photos.map((src,i)=>(
                      <motion.img key={i} src={src} alt={`foto ${i+1}`}
                        initial={{opacity:0,scale:.8}} animate={{opacity:1,scale:1}} exit={{opacity:0,scale:.8}}
                        transition={{type:'spring' as const,damping:18,stiffness:280}}
                        whileHover={{scale:1.08,zIndex:10}}
                        onClick={()=>window.open(src,'_blank')}
                        style={{width:72,height:72,objectFit:'cover',borderRadius:10,border:`1px solid ${T.border}`,cursor:'pointer'}}/>
                    ))}
                  </AnimatePresence>
                  {photos.length===0&&<span style={{fontSize:13,color:T.faint}}>Sin fotos adjuntas</span>}
                </div>
                <motion.label whileHover={{scale:1.02,borderColor:G+'66'}} whileTap={{scale:.97}}
                  style={{display:'inline-flex',alignItems:'center',gap:7,padding:'7px 13px',background:T.head,border:`1px solid ${T.border}`,borderRadius:9,cursor:'pointer',fontSize:12.5,fontWeight:500,color:T.dim}}>
                  <input type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={addPhoto} disabled={uploading}/>
                  <Ic d={IC.cam} s={14} c={T.dim}/>
                  {uploading?'Subiendo…':'Añadir foto'}
                </motion.label>
              </div>
            </div>
          </motion.div>

          {/* TIMELINE */}
          <motion.div variants={vCard}>
            <div style={{borderRadius:16,background:T.card,border:`1px solid ${T.border}`,boxShadow:T.shadow,backdropFilter:'blur(16px)',overflow:'hidden'}}>
              <div style={{padding:'13px 20px',borderBottom:`1px solid ${T.border}`,display:'flex',alignItems:'center',gap:9}}>
                <span style={{fontSize:16}}>🕐</span>
                <span style={{fontSize:11.5,fontWeight:700,color:T.faint,letterSpacing:'.07em',textTransform:'uppercase'}}>Historial</span>
              </div>
              <div style={{padding:'18px 20px'}}>
                {([
                  {date:data.createdAt,  label:'Solicitud creada',          icon:'📋',active:true},
                  {date:data.receivedAt, label:'Paquete recibido',           icon:'📦',active:!!data.receivedAt},
                  {date:data.verifiedAt, label:data.verificationStatus==='ISSUE'?'Verificación: incidencia':'Verificación correcta', icon:data.verificationStatus==='ISSUE'?'⚠️':'✅',active:!!data.verifiedAt},
                  {date:data.refundedAt, label:`Reembolso procesado${ref?` · ${ref.toFixed(2)}€`:''}`, icon:'💰',active:!!data.refundedAt},
                ] as {date:string|null|undefined;label:string;icon:string;active:boolean}[]).map((ev,i)=>(
                  <motion.div key={i} custom={i} variants={vRow(i)} initial="hidden" animate="show"
                    style={{display:'flex',gap:14,marginBottom:i<3?16:0,opacity:ev.active?1:.28}}>
                    <div style={{display:'flex',flexDirection:'column',alignItems:'center'}}>
                      <motion.div custom={i} variants={vDot(i)} initial="hidden" animate="show"
                        style={{width:32,height:32,borderRadius:'50%',background:ev.active?`rgba(52,178,123,.13)`:T.head,border:`1px solid ${ev.active?G+'44':T.border}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,flexShrink:0}}>
                        {ev.icon}
                      </motion.div>
                      {i<3&&<div style={{width:1,flex:1,minHeight:18,background:ev.active?G+'44':T.border,margin:'5px 0'}}/>}
                    </div>
                    <div style={{paddingTop:5,paddingBottom:i<3?12:0}}>
                      <div style={{fontSize:13.5,fontWeight:ev.active?600:400,color:ev.active?T.tx:T.faint}}>{ev.label}</div>
                      {ev.date&&<div style={{fontSize:11.5,color:T.faint,marginTop:2}}>{new Date(ev.date).toLocaleString('es-ES',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</div>}
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>

        </div>{/* /LEFT */}

        {/* ── SIDEBAR ── */}
        <div style={{display:'flex',flexDirection:'column',gap:14}}>

          {/* ESTADO */}
          <motion.div variants={vSide}>
            <div style={{borderRadius:16,background:T.card,border:`1px solid ${T.border}`,boxShadow:T.shadow,backdropFilter:'blur(16px)',overflow:'hidden'}}>
              {/* top accent bar */}
              <div style={{height:3,background:`linear-gradient(90deg,${sm.dot},transparent)`}}/>
              <div style={{padding:'14px 18px'}}>
                {/* pill */}
                <AnimatePresence mode="wait">
                  <motion.div key={data.status} variants={vPill} initial="hidden" animate="show" exit="hidden"
                    style={{display:'inline-flex',alignItems:'center',gap:7,fontSize:13,fontWeight:650,padding:'6px 14px',borderRadius:100,color:sm.fg,background:sm.bg,border:`1px solid ${sm.dot}33`,marginBottom:14}}>
                    <motion.span animate={{opacity:[1,.35,1]}} transition={{duration:2.2,repeat:Infinity}}
                      style={{width:7,height:7,borderRadius:'50%',background:sm.dot,boxShadow:`0 0 8px ${sm.dot}cc`}}/>
                    {sm.label}
                  </motion.div>
                </AnimatePresence>

                {/* refund banner */}
                {data.status==='APPROVED'&&(
                  <motion.div initial={{opacity:0,y:5}} animate={{opacity:1,y:0}}
                    style={{padding:'10px 12px',borderRadius:9,background:data.refundedAt?'rgba(63,185,138,.1)':'rgba(240,180,41,.08)',border:`1px solid ${data.refundedAt?'rgba(63,185,138,.3)':'rgba(240,180,41,.25)'}`,marginBottom:14}}>
                    {data.refundedAt
                      ?<div style={{fontSize:12.5,fontWeight:600,color:'#3fb98a'}}>✓ Reembolso enviado · {ref?.toFixed(2)}€<div style={{fontSize:11.5,opacity:.8,marginTop:1}}>{new Date(data.refundedAt).toLocaleDateString('es-ES',{day:'2-digit',month:'short',year:'numeric'})}</div></div>
                      :<div style={{fontSize:12.5,fontWeight:600,color:'#f0b429'}}>⏳ Reembolso pendiente</div>
                    }
                  </motion.div>
                )}

                {/* payment pending */}
                {data.paymentStatus==='PENDING'&&data.checkoutUrl&&(
                  <div style={{padding:'10px 12px',borderRadius:9,background:'rgba(224,106,106,.08)',border:'1px solid rgba(224,106,106,.25)',marginBottom:14}}>
                    <div style={{fontSize:12.5,fontWeight:600,color:'#e06a6a'}}>💳 Pago pendiente</div>
                    {data.totalAmount!=null&&data.totalAmount>0&&<div style={{fontSize:14,fontWeight:700,color:'#e06a6a',marginTop:2}}>{data.totalAmount.toFixed(2)}€</div>}
                    <a href={data.checkoutUrl} target="_blank" rel="noopener noreferrer" style={{fontSize:12,color:'#5b9bd5',textDecoration:'none',display:'inline-flex',alignItems:'center',gap:4,marginTop:6,fontWeight:500}}>Ver checkout ↗</a>
                  </div>
                )}

                {/* change state */}
                <div style={{fontSize:10.5,fontWeight:700,color:T.faint,letterSpacing:'.08em',marginBottom:8}}>CAMBIAR ESTADO</div>
                <div style={{display:'flex',flexDirection:'column',gap:4}}>
                  {Object.entries(SM).filter(([k])=>k!==data.status).map(([key,meta])=>(
                    <motion.button key={key} whileHover={{x:4}} whileTap={{scale:.97}}
                      onClick={()=>upStatus(key)} disabled={act}
                      style={{padding:'8px 12px',fontSize:12.5,fontWeight:600,cursor:'pointer',color:meta.fg,background:meta.bg,border:`1px solid ${meta.dot}33`,borderRadius:9,textAlign:'left',opacity:act?.45:1,fontFamily:FONT,display:'flex',alignItems:'center',gap:7}}>
                      <span style={{width:6,height:6,borderRadius:'50%',background:meta.dot,boxShadow:`0 0 6px ${meta.dot}88`}}/>
                      {meta.label}
                    </motion.button>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>

          {/* CLIENTE */}
          <motion.div variants={vSide}>
            <div style={{borderRadius:16,background:T.card,border:`1px solid ${T.border}`,boxShadow:T.shadow,backdropFilter:'blur(16px)',overflow:'hidden'}}>
              <div style={{padding:'13px 18px',borderBottom:`1px solid ${T.border}`,display:'flex',alignItems:'center',gap:9}}>
                <span style={{fontSize:16}}>👤</span>
                <span style={{fontSize:11.5,fontWeight:700,color:T.faint,letterSpacing:'.07em',textTransform:'uppercase'}}>Cliente</span>
              </div>
              <div style={{padding:'10px 18px'}}>
                {[
                  {l:'Nombre',v:data.customerName},
                  {l:'Email',v:<a href={`mailto:${data.customerEmail}`} style={{color:'#5b9bd5',textDecoration:'none'}}>{data.customerEmail}</a>},
                  ...(data.order.customerPhone?[{l:'Teléfono',v:data.order.customerPhone}]:[]),
                  ...(addr(data.order.shippingAddressJson)!=='—'?[{l:'Dirección',v:addr(data.order.shippingAddressJson)}]:[]),
                ].map((row,i)=>(
                  <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',padding:'8px 0',borderBottom:i<3?`1px solid ${T.bs}`:'none'}}>
                    <span style={{fontSize:12,color:T.faint,fontWeight:500,flexShrink:0,marginRight:12}}>{row.l}</span>
                    <span style={{fontSize:13,color:T.tx,fontWeight:500,textAlign:'right'}}>{row.v}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* PEDIDO ORIGINAL */}
          <motion.div variants={vSide}>
            <div style={{borderRadius:16,background:T.card,border:`1px solid ${T.border}`,boxShadow:T.shadow,backdropFilter:'blur(16px)',overflow:'hidden'}}>
              <div style={{padding:'13px 18px',borderBottom:`1px solid ${T.border}`,display:'flex',alignItems:'center',gap:9}}>
                <span style={{fontSize:16}}>🛒</span>
                <span style={{fontSize:11.5,fontWeight:700,color:T.faint,letterSpacing:'.07em',textTransform:'uppercase'}}>Pedido original</span>
              </div>
              <div style={{padding:'10px 18px'}}>
                {[
                  {l:'Nº pedido',v:<span style={{fontWeight:700,fontVariantNumeric:'tabular-nums'}}>{data.shopifyOrderNumber}</span>},
                  ...(data.order.totalPrice!=null?[{l:'Total',v:`${data.order.totalPrice.toFixed(2)}€`}]:[]),
                  ...(data.order.createdAt?[{l:'Compra',v:new Date(data.order.createdAt).toLocaleDateString('es-ES',{day:'2-digit',month:'short',year:'numeric'})}]:[]),
                  {l:'Solicitud',v:new Date(data.createdAt).toLocaleString('es-ES',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})},
                ].map((row,i,a)=>(
                  <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',padding:'8px 0',borderBottom:i<a.length-1?`1px solid ${T.bs}`:'none'}}>
                    <span style={{fontSize:12,color:T.faint,fontWeight:500,flexShrink:0,marginRight:12}}>{row.l}</span>
                    <span style={{fontSize:13,color:T.tx,fontWeight:500,textAlign:'right'}}>{row.v}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* ENVÍO */}
          <motion.div variants={vSide}>
            <div style={{borderRadius:16,background:T.card,border:`1px solid ${T.border}`,boxShadow:T.shadow,backdropFilter:'blur(16px)',overflow:'hidden'}}>
              <div style={{padding:'13px 18px',borderBottom:`1px solid ${T.border}`,display:'flex',alignItems:'center',gap:9}}>
                <span style={{fontSize:16}}>🚚</span>
                <span style={{fontSize:11.5,fontWeight:700,color:T.faint,letterSpacing:'.07em',textTransform:'uppercase'}}>Envío y seguimiento</span>
              </div>
              <div style={{padding:'12px 18px'}}>
                {data.trackingNumber?(
                  <>
                    {[
                      {l:'Tracking',v:<span style={{fontFamily:'monospace',fontSize:12,fontWeight:700}}>{data.trackingNumber}</span>},
                      ...(data.carrier?[{l:'Transportista',v:data.carrier}]:[]),
                    ].map((row,i)=>(
                      <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'7px 0',borderBottom:`1px solid ${T.bs}`}}>
                        <span style={{fontSize:12,color:T.faint,fontWeight:500}}>{row.l}</span>
                        <span style={{fontSize:13,color:T.tx,fontWeight:500}}>{row.v}</span>
                      </div>
                    ))}
                    {data.labelUrl&&(
                      <motion.a whileHover={{y:-2,boxShadow:`0 10px 22px -8px ${G}88`}}
                        href={data.labelUrl.startsWith('http')?data.labelUrl:`${API}${data.labelUrl}`}
                        target="_blank" rel="noopener noreferrer"
                        style={{display:'flex',alignItems:'center',justifyContent:'center',gap:8,marginTop:12,padding:'10px',background:`linear-gradient(140deg,${G},${G2})`,color:'#fff',borderRadius:9,fontSize:13,fontWeight:600,textDecoration:'none',boxShadow:`0 5px 14px -5px ${G}88`}}>
                        <Ic d={IC.down} s={14} c="#fff"/> Descargar etiqueta
                      </motion.a>
                    )}
                    <motion.a whileHover={{y:-1,borderColor:G+'55'}}
                      href={`/devoluciones/estado/${data.id}`} target="_blank" rel="noopener noreferrer"
                      style={{display:'flex',alignItems:'center',justifyContent:'center',gap:6,marginTop:8,padding:'8px',background:T.head,border:`1px solid ${T.border}`,color:T.dim,borderRadius:9,fontSize:12,fontWeight:500,textDecoration:'none'}}>
                      📍 Ver estado cliente ↗
                    </motion.a>
                  </>
                ):(
                  <div>
                    <p style={{fontSize:13,color:T.faint,margin:'0 0 12px'}}>{data.status==='REQUESTED'?'Etiqueta pendiente de generar':'Sin tracking aún'}</p>
                    {data.status==='REQUESTED'&&(
                      <motion.button whileHover={{y:-2,boxShadow:`0 10px 22px -8px ${G}99`}} whileTap={{scale:.97}}
                        onClick={()=>upStatus('LABEL_CREATED')} disabled={act}
                        style={{width:'100%',padding:'10px',background:`linear-gradient(140deg,${G},${G2})`,color:'#fff',border:'none',borderRadius:9,fontSize:13,fontWeight:600,cursor:'pointer',opacity:act?.5:1,fontFamily:FONT,display:'flex',alignItems:'center',justifyContent:'center',gap:7,boxShadow:`0 5px 14px -5px ${G}88`}}>
                        <Ic d={IC.tag} s={14} c="#fff"/> Generar etiqueta
                      </motion.button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </motion.div>

          {/* IMPORTES */}
          {(data.totalAmount!=null||ref!=null)&&(
            <motion.div variants={vSide}>
              <div style={{borderRadius:16,background:T.card,border:`1px solid ${T.border}`,boxShadow:T.shadow,backdropFilter:'blur(16px)',overflow:'hidden'}}>
                <div style={{padding:'13px 18px',borderBottom:`1px solid ${T.border}`,display:'flex',alignItems:'center',gap:9}}>
                  <span style={{fontSize:16}}>💰</span>
                  <span style={{fontSize:11.5,fontWeight:700,color:T.faint,letterSpacing:'.07em',textTransform:'uppercase'}}>Importes</span>
                </div>
                <div style={{padding:'10px 18px'}}>
                  {data.totalAmount!=null&&data.totalAmount>0&&(
                    <div style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:`1px solid ${T.bs}`}}>
                      <span style={{fontSize:12,color:T.faint,fontWeight:500}}>Coste etiqueta</span>
                      <span style={{fontSize:13,color:T.tx,fontWeight:500}}>{data.totalAmount.toFixed(2)}€</span>
                    </div>
                  )}
                  {ref!=null&&ref>0&&(
                    <div style={{display:'flex',justifyContent:'space-between',padding:'8px 0'}}>
                      <span style={{fontSize:12,color:T.faint,fontWeight:500}}>Reembolso</span>
                      <span style={{fontSize:14,fontWeight:750,color:data.refundedAt?'#3fb98a':T.faint,fontVariantNumeric:'tabular-nums'}}>{ref.toFixed(2)}€{data.refundedAt?' ✓':' (pendiente)'}</span>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {/* MODAL placeholder — generate label action already inline */}
        </div>{/* /SIDEBAR */}

      </motion.div>{/* /BODY */}
    </div>
  );
}
