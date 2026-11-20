(function(){var K="sp-theme-v1",R=document.documentElement,used={};
var HX=/^#[0-9a-f]{6}$/i,PX=/^\d+px$/,CK=["primary","primaryHover","accent","bgApp","surface","border","text1","text2","success","warning","danger","info"];
function apply(v){Object.keys(used).forEach(function(k){R.style.removeProperty(k)});used={};Object.keys(v||{}).forEach(function(k){R.style.setProperty(k,v[k]);used[k]=1})}
function ok(d){if(!d||typeof d!=="object"||!d.state||!d.vars)return false;var s=d.state;if(CK.some(function(k){return !HX.test(s[k]||"")}))return false;if(["Light","Dark","System"].indexOf(s.mode)<0||["Default","Compact"].indexOf(s.sidebar)<0||["Small","Medium","Large"].indexOf(s.radius)<0)return false;return Object.keys(d.vars).every(function(k){return /^--[a-z0-9-]+$/.test(k)&&(HX.test(d.vars[k])||PX.test(d.vars[k]))})}
function load(){try{var d=JSON.parse(localStorage.getItem(K));return ok(d)?d:null}catch(e){return null}}
window.SPTheme={load:load,apply:apply,save:function(state,vars){try{localStorage.setItem(K,JSON.stringify({state:state,vars:vars}));return true}catch(e){return false}},clear:function(){try{localStorage.removeItem(K)}catch(e){}apply({})}};
var d=load();if(d){apply(d.vars);R.setAttribute("data-sidebar-style",d.state.sidebar.toLowerCase())}})();
