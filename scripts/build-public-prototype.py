# Builds a public copy of the 17 Oct internal prototype for the live app (/prototype).
# Removed (not hidden): Ideas map and the mechanisms list (trade secret), the four strategy questions,
# Will it win?, Ship it, the prototype's own Evals and Under the hood (the app has its own, measured on the
# deployed code), the Gemini key panel. Photos: kept as in the prototype (Jon, 18 Oct: unblurred is OK).
import re, sys, pathlib
SRC = pathlib.Path(sys.argv[1]); OUT = pathlib.Path(sys.argv[2])
r = lambda f: (SRC / f).read_text()
def cut_between(s, start, end, repl):
    i = s.index(start); j = s.index(end, i)
    return s[:i] + repl + s[j:]
def once(s, a, b):
    assert s.count(a) == 1, (a[:60], s.count(a)); return s.replace(a, b)

data = r('data.js')
data = cut_between(data, 'const STATUS = {', 'const AMB', 'const STATUS = {};\n')
data = cut_between(data, 'const QS = [', 'const SRC = {', 'const QS = [];\n')
i = data.index('const SRC = {'); j = data.index('};', i) + 2
keep = [ln for ln in data[i:j].split('\n')[1:-1] if 'u:"https' in ln]
data = data[:i] + 'const SRC = {\n' + '\n'.join(keep) + '\n};' + data[j:]
data = cut_between(data, 'const IDEAS = [', 'const MECHS = [', 'const IDEAS = [];\n')
data = cut_between(data, 'const MECHS = [', 'const MONTHS = [', 'const MECHS = [];\n')

win = 'function renderWin(){}\nfunction winExtra(){}\n'

more = r('more.js')
i = more.index('// ================= EVALS ================='); j = more.index('// =====', more.index('// ================= SHIP IT =================') + 10)
more = more[:i] + 'XR.evals=function(){};XR.hood=function(){};XR.ship=function(){};const EVAL={};\n' + more[j:]
more = once(more, "VIEWS.splice(iw,0,{k:'evals',n:'Evals',who:['referee']},{k:'hood',n:'Under the hood',who:['referee']});", '')
more = once(more, "VIEWS.splice(ii,0,{k:'ship',n:'Ship it',who:[],internal:true});", '')
more = once(more, "'Internal prototype · unblurred site photos · trade-secret mechanisms in Ideas'", "'Interactive prototype · recorded results; live Gemini with the judge access code'")

app = r('app.js')
for v in ["\n {k:'gemini',n:'Gemini and learning',who:['referee']},", "\n {sep:'Thinking'},", "\n {k:'win',n:'Will it win?',who:[]},", "\n {k:'ideas',n:'Ideas map',who:[]}"]:
    app = once(app, v, '')
app = app.replace("{k:'reports',n:'Reports',who:['owner','public']},", "{k:'reports',n:'Reports',who:['owner','public']}")
app = once(app, 'function renderGemini(){', 'function renderGemini(){return;')
app = once(app, 'function geminiWire(){', 'function geminiWire(){return;')
app = app.replace('// ================= INIT =================', more + '\n// ================= INIT =================', 1)

html = r('app.html')
html = cut_between(html, '<!-- GEMINI -->', '<!-- EVALS -->', '<!-- GEMINI -->\n<section class="view" id="v-gemini"><div class="card"><p>Live Gemini runs happen on the server in the workbench, with the judge access code. This prototype replays recorded results.</p></div></section>\n')
for sec in ['<!-- IDEAS -->']:
    i = html.index(sec); j = html.index('</section>', i) + len('</section>')
    html = html[:i] + '<section class="view" id="v-ideas"></section>' + html[j:]
html = once(html, 'Internal prototype · unblurred site photos · trade-secret mechanisms in Ideas', 'Interactive prototype · recorded results; live Gemini with the judge access code')

L = SRC / 'lib'
gem = r('gemini.js')
i = gem.index('const GEM = {'); j = gem.index('function b64of')
gem = gem[:i] + '''const GEM = {key:'server', model:'gemini-3.8-flash', imageModel:'gemini-3.1-flash-image', models:['gemini-3.8-flash','gemini-3.1-flash-image'], log:[]};
// Live calls go to the app's server (Vertex AI, no key in the browser), which needs the judge access code.
const POP_BASE = location.pathname.replace(/\\/prototype\\/?$/, '');
async function gemListModels(){ return GEM.models; }
''' + gem[j:]
i = gem.index('async function gemCall('); j = gem.index('function gemText(')
gem = gem[:i] + '''async function gemCall(model,parts,gen={},kind='call'){
  const t0=performance.now();
  const r=await fetch(POP_BASE+'/api/proto/gemini',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','x-pop-request':'1'},body:JSON.stringify({kind,parts,gen})});
  const j=await r.json().catch(()=>({})); const ms=Math.round(performance.now()-t0);
  GEM.log.push({at:new Date().toISOString().slice(11,19),kind,model:j.model||model,ok:r.ok,ms,usage:j.usageMetadata||null,err:r.ok?null:((j.error&&j.error.message)||r.statusText)});
  if(!r.ok) throw new Error((j.error&&j.error.message)||r.statusText);
  return j;
}
''' + gem[j:]
rep = {'/*THREE*/': (L / 'three.min.js').read_text(), '/*ORBIT*/': (L / 'OrbitControls.js').read_text(), '/*IMGS*/': r('imgs.json'), '/*LIVE*/': r('live.json'), '/*DATA*/': data, '/*MODEL*/': r('model.js'), '/*VISUALS*/': r('visuals.js'), '/*WIN*/': win, '/*GEMINI*/': gem, '/*APP*/': app, '/*IMGSPUB*/': r('imgs_pub.json'), '/*LIVEPUB*/': r('live_pub.json')}
for k, v in rep.items():
    i = html.index(k); html = html[:i] + v + html[i + len(k):]
html = html.replace(" (Jon\\'s R04, R06)", '')
# House wording, applied outside the embedded image data only.
parts = re.split(r'(data:[a-z/+-]+;base64,[A-Za-z0-9+/=]+)', html)
def clean(t):
    t = t.replace("Never say anything is fraudulent, fake or proven.", "Do not comment on anyone's honesty or intent.")
    t = t.replace("Never say fraud, fake, proof or proven.", "Do not comment on anyone's honesty or intent.")
    t = t.replace("TEST · fabricated copy", "TEST · edited copy")
    t = t.replace("April billing, split by", "April progress claim, split by")
    t = re.sub(r"\n\s*shift:\{t:\"Shift Technology[^\n]*", "", t)
    t = t.replace("\u2014", "n/a")
    t = re.sub(r"\bbilledPeriod\b", "claimedPeriod", t)
    t = re.sub(r"\bbilled\b", "claimedAmt", t)
    t = re.sub(r"\bbill\b", "claimAmt", t)
    t = re.sub(r"\b[Bb]illing\b", "progress claim", t)
    t = re.sub(r"\b[Bb]illed\b", "claimed", t)
    return t
html = ''.join(p if i % 2 else clean(p) for i, p in enumerate(parts))
OUT.write_text(html)
print(OUT, len(html) // 1024, 'KB')
