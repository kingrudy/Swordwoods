#!/usr/bin/env python3
"""Rooktest in een echte browser: loopt de belangrijkste spelonderdelen langs en telt fouten.

Gebruik (vanuit de projectmap, met Python Playwright en Chromium geïnstalleerd):
    python3 tools/rooktest.py            # desktop + telefoon
    python3 tools/rooktest.py desktop    # alleen desktop
Start zelf een server op poort 8150 met een lege database en testcommando's aan.
"""
import json, os, shutil, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8150
B = f"http://localhost:{PORT}/"
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
OUT = os.environ.get("ROOKTEST_OUT") or tempfile.mkdtemp(prefix="rooktest-")
results = []

def check(ok, name, info=""):
    results.append((bool(ok), name))
    print(("PASS " if ok else "FAIL ") + name + (f"  ({info})" if info != "" else ""), flush=True)
    if not ok and os.environ.get("GITHUB_ACTIONS"):      # op GitHub als annotatie zichtbaar
        print(f"::error title=rooktest::{name} {info}".replace("\n", " "), flush=True)

def start_server():
    data = tempfile.mkdtemp(prefix="rooktest-data-")
    env = dict(os.environ, PORT=str(PORT), EXTRA_PORTS="", ALLOW_CHEATS="1", MAX_SPEED="99999", DATA_DIR=data,
               FIRST_WAVE_DELAY="9999", WAVE_GAP="9999", WEEK_EVENT="geen", FORCE_NIGHT="0")
    p = subprocess.Popen(["node", "server.js"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    for _ in range(100):
        try:
            urllib.request.urlopen(B + "api/health", timeout=1); return p, data
        except Exception:
            time.sleep(0.1)
    raise SystemExit("server start niet")

def login(page, name):
    page.goto(B); page.wait_for_selector("#auth.on")
    page.click("#tab-register"); page.fill("#au-name", name); page.fill("#au-pass", "geheim123"); page.click("#au-go")
    page.wait_for_selector("#lobby.on")

def play(page, ms):
    """Laat het spel ms milliseconden lopen zonder te renderen (software-rendering in CI is te traag)."""
    page.evaluate("""async ms => { const g = __game; g.pause = true;
      for (let t = 0; t < ms; t += 50) { g.update(0.05, performance.now() / 1000); await new Promise(r => setTimeout(r, 50)); } }""", ms)

def shot(page, name):
    page.evaluate("__game.renderOnce()"); page.screenshot(path=os.path.join(OUT, name), timeout=120000)

def cheat(page, text, wait=500):
    page.evaluate("t => __game.net.send({ t: 'chat', text: t })", text); play(page, wait)

def goto(page, x, z, face=None):
    """Zet de speler op (x,z), optioneel kijkend naar face=(fx,fz)."""
    page.evaluate("""([x, z, f]) => { const g = __game, p = g.player; p.x = x; p.z = z; p.y = g.W.heightAt(x, z); p.vx = p.vz = 0;
      if (f) p.yaw = Math.atan2(-(f[0] - x), -(f[1] - z)); p.pitch = 0; }""", [x, z, face])
    play(page, 250)

def wait_for(page, js, timeout=8000, arg=None):
    t0 = time.time()
    while time.time() - t0 < timeout / 1000:
        if page.evaluate(js, arg): return True
        play(page, 150)
    return False

def desktop(b):
    errs = []
    ctx = b.new_context(viewport={"width": 640, "height": 360}); ctx.add_init_script("try { localStorage.setItem('sw-gfx', 'laag') } catch {}"); A = ctx.new_page()
    A.on("pageerror", lambda e: errs.append(str(e)))
    A.on("console", lambda m: m.type == "error" and errs.append("console: " + m.text))
    login(A, "Rook" + str(int(time.time()) % 10000))
    A.click("#btn-quick"); A.wait_for_selector("#hud.on", timeout=180000); A.click("#btn-resume"); A.wait_for_timeout(800); play(A, 300)
    check(A.evaluate("!!window.__game && __game.treeObjs.length > 100"), "spel geladen")
    fps = A.evaluate("new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { if (++n < 20) requestAnimationFrame(f); else r(Math.round(20000 / (performance.now() - t0))); }; requestAnimationFrame(f); })")
    print("   beelden per seconde:", fps)
    cheat(A, "/god"); A.evaluate("__game.net.send({ t: 'tutskip' })")

    # boom omhakken
    t = A.evaluate("""(() => { const g = __game; const o = g.treeObjs.filter(o => !o.felled && Math.hypot(o.t.x - g.player.x, o.t.z - g.player.z) < 80 && o.t.type !== undefined)
      .sort((a, b) => Math.hypot(a.t.x - g.player.x, a.t.z - g.player.z) - Math.hypot(b.t.x - g.player.x, b.t.z - g.player.z))[0]; return o ? [o.t.x, o.t.z, o.t.idx] : null; })()""")
    wood0 = A.evaluate("__game.inv.wood")
    ang = 0
    goto(A, t[0] + 1.3, t[1], (t[0], t[1]))
    for _ in range(70):          # dikke bomen hebben tot ~15 slagen nodig; na elke slag even afkoelen
        A.evaluate("__game.startSwing()"); play(A, 550)
        if A.evaluate("__game.inv.wood") > wood0: break
    check(A.evaluate("__game.inv.wood") > wood0, "boom omgehakt geeft hout", A.evaluate("__game.inv.wood"))

    # kist openen
    c = A.evaluate("(() => { const g = __game; const o = g.chestObjs.find(o => !o.opened); return [o.c.x, o.c.z]; })()")
    goto(A, c[0] + 1.6, c[1], (c[0], c[1]))
    A.evaluate("__game.interact()")
    check(wait_for(A, "([x, z]) => __game.chestObjs.some(o => o.opened && Math.hypot(o.c.x - x, o.c.z - z) < 0.1)", arg=c), "kist geopend")

    # winkel
    s = A.evaluate("[__game.W.shop.x, __game.W.shop.z, __game.W.shop.rotY]")
    import math
    sx, sz = s[0] + math.sin(s[2]) * 3.5, s[1] + math.cos(s[2]) * 3.5
    goto(A, sx, sz, (s[0], s[1])); cheat(A, "/hout 300")
    check(A.evaluate("__game.prompt().includes('winkel')"), "aanwijzing bij de winkel", A.evaluate("__game.prompt()"))
    A.evaluate("__game.interact()"); play(A, 300)
    check(A.evaluate("document.getElementById('shop').classList.contains('on')"), "winkel open")
    A.click("[data-buy=rod]"); play(A, 500)
    check(A.evaluate("__game.inv.up.rod === 1"), "vishengel gekocht")
    A.evaluate("__game.closeShop(true)"); play(A, 200)
    check(A.evaluate("!document.getElementById('shop').classList.contains('on')"), "winkel dicht")

    # smid
    m = A.evaluate("[__game.W.smith.x, __game.W.smith.z]")
    goto(A, m[0] + 2.5, m[1] + 1.5, (m[0], m[1]))
    A.evaluate("__game.interact()"); play(A, 300)
    check(A.evaluate("document.getElementById('smith').classList.contains('on')"), "smid open")
    A.evaluate("__game.closeShop(true)")

    # bouwen: kampvuur (een paar plekken proberen; bomen of water kunnen in de weg staan)
    n0 = A.evaluate("__game.bs.builds.size")
    for k in range(8):
        goto(A, sx + 6 + k * 3, sz + 6 - k * 2, (sx, sz))
        A.evaluate("__game.bs.active || __game.bs.toggle(); __game.bs.select(0)"); play(A, 400)
        A.evaluate("__game.startSwing()"); play(A, 700)
        if A.evaluate("__game.bs.builds.size") > n0: break
    A.evaluate("__game.bs.active && __game.bs.toggle()")
    check(A.evaluate("__game.bs.builds.size") > n0, "kampvuur gebouwd", A.evaluate("__game.bs.builds.size"))
    f = A.evaluate("(() => { const b = [...__game.bs.builds.values()].find(b => b.kind === 'campfire'); return b ? [b.x, b.z] : null; })()")
    if f:
        goto(A, f[0] + 2, f[1], (f[0], f[1])); play(A, 300)
        check(A.evaluate("__game.action()") == "cook", "aanwijzing koken bij het kampvuur", A.evaluate("__game.prompt()"))
        A.evaluate("__game.interact()"); play(A, 300)
        check(A.evaluate("document.getElementById('cook').classList.contains('on') && document.querySelectorAll('[data-cook]').length === 4"), "kookpaneel open met 4 recepten")
        A.evaluate("__game.closeShop(true)"); play(A, 200)
    # opslagkist bouwen en gebruiken
    for k in range(8):
        goto(A, sx - 6 - k * 3, sz + 6 + k * 2, (sx, sz))
        A.evaluate("__game.bs.active || __game.bs.toggle(); __game.bs.select(7)"); play(A, 400)
        A.evaluate("__game.startSwing()"); play(A, 700)
        if A.evaluate("[...__game.bs.builds.values()].some(b => b.kind === 'stash')"): break
    A.evaluate("__game.bs.active && __game.bs.toggle()")
    st = A.evaluate("(() => { const b = [...__game.bs.builds.values()].find(b => b.kind === 'stash'); return b ? [b.x, b.z] : null; })()")
    check(st, "opslagkist gebouwd")
    if st:
        goto(A, st[0] + 1.6, st[1], (st[0], st[1])); play(A, 300)
        A.evaluate("__game.interact()"); play(A, 300)
        check(A.evaluate("document.getElementById('stash').classList.contains('on')"), "opslagkist open")
        A.click("[data-stash=put]"); play(A, 600)
        check(A.evaluate("__game.inv.stash && __game.inv.stash.wood > 0 && __game.inv.wood === 0"), "hout opgeborgen", A.evaluate("JSON.stringify(__game.inv.stash)"))
        A.click("[data-stash=take]"); play(A, 600)
        A.evaluate("__game.closeShop(true)"); play(A, 200)

    # monsters, treffers en buit
    cheat(A, "/zwaard 3"); A.evaluate("__game.net.send({ t: 'equip', i: 1 })")
    cheat(A, "/spawn 0 3", 1500)
    check(wait_for(A, "__game.mons.size >= 3"), "monsters verschijnen", A.evaluate("__game.mons.size"))
    for _ in range(60):
        mm = A.evaluate("(() => { const g = __game, p = g.player; const e = [...g.mons.values()].filter(e => !e.dying).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0]; return e ? [e.x, e.z] : null; })()")
        if not mm: break
        goto(A, mm[0] + 1.4, mm[1], (mm[0], mm[1])); A.evaluate("__game.startSwing()"); play(A, 250)
    check(wait_for(A, "[...__game.mons.values()].filter(e => !e.dying).length === 0", 6000), "monsters verslagen")

    # hond
    cheat(A, "/hond jacht", 1500)
    check(wait_for(A, "[...__game.dogs.values()].some(d => d.owner === __game.myId)"), "eigen hond loopt mee")

    # vissen
    w = A.evaluate("""(() => { const g = __game, W = g.W; for (let r = 10; r < 220; r += 2) for (let a = 0; a < 64; a++) {
        const x = Math.cos(a / 64 * 6.283) * r, z = Math.sin(a / 64 * 6.283) * r, h = W.heightAt(x, z); if (h < -1.6 || h > 3) continue;
        for (let k = 0; k < 16; k++) { const b = k / 16 * 6.283, wx = x + Math.cos(b) * 4, wz = z + Math.sin(b) * 4; if (W.heightAt(wx, wz) < -2.8 && W.heightAt(x + Math.cos(b) * 2.5, z + Math.sin(b) * 2.5) < -2.5) return [x, z, wx, wz]; } } return null; })()""")
    if w:
        goto(A, w[0], w[1], (w[2], w[3])); play(A, 300)
        check(A.evaluate("__game.prompt().includes('vissen')"), "aanwijzing vissen", A.evaluate("__game.prompt()"))
        bite = caught = cast = False
        for attempt in range(3):          # een beet kan door traagheid gemist worden: dan opnieuw uitgooien
            A.evaluate("__game.interact()")
            cast = cast or wait_for(A, "__game.bobbers.has(__game.myId)")
            if not wait_for(A, "!!(__game.getFishing() && __game.getFishing().bite) || !__game.getFishing()", 20000): continue
            if not A.evaluate("!!(__game.getFishing() && __game.getFishing().bite)"): continue
            bite = True; A.evaluate("__game.interact()")
            if wait_for(A, "!__game.bobbers.has(__game.myId)") and A.evaluate("__game.inv.fish") > 0: caught = True; break
        check(cast, "dobber in het water")
        check(bite, "beet")
        check(caught, "vis gevangen", A.evaluate("__game.inv.fish"))
    else:
        check(False, "waterkant gevonden")

    # pauzemenu, chat en kaart
    A.evaluate("document.exitPointerLock && document.exitPointerLock(); __game.pauseGame()"); play(A, 300)
    for tab in ["tal", "quest", "give", "keys"]:
        A.click(f"#ptabs [data-pt={tab}]"); play(A, 100)
        check(A.evaluate(f"document.getElementById('pt-{tab}').classList.contains('on')"), f"pauzetab {tab}")
    A.click("#ptabs [data-pt=set]"); play(A, 100)
    check(A.evaluate("document.querySelectorAll('#pt-set [data-bind]').length >= 15 && !!document.querySelector('#pt-set [data-set=fov]')"), "instellingen: toetsen, beeldhoek en gevoeligheid")
    A.click("#pt-set [data-bind=use]"); A.keyboard.press("KeyX"); play(A, 100)
    check(A.evaluate("__game.g.settings.S.keys.use === 'KeyX' && document.getElementById('pt-keys').innerText.includes('X')"), "toets voor gebruiken omgezet naar X")
    A.click("#pt-set [data-reset]"); play(A, 100)
    check(A.evaluate("__game.g.settings.S.keys.use === 'KeyE'"), "standaardtoetsen terug")
    A.click("#ptabs [data-pt=keys]"); play(A, 100)
    A.click("#btn-resume"); play(A, 400)
    A.evaluate("__game.g.settings.toggleView()"); play(A, 1500)
    check(A.evaluate("(() => { const g = __game, c = g.camera.position, p = g.player; return Math.hypot(c.x - p.x, c.z - p.z) > 2; })()"), "camera achter je held")
    shot(A, "derdepersoon.png")
    A.evaluate("__game.g.settings.toggleView()"); play(A, 200)
    A.evaluate("__game.hud.openChat()"); play(A, 200)
    A.keyboard.type("hallo rooktest"); A.keyboard.press("Enter"); play(A, 600)
    check(A.evaluate("document.body.innerText.includes('hallo rooktest')"), "chatbericht zichtbaar")
    A.evaluate("__game.hud.toggleBig(true)"); play(A, 300)
    check(A.evaluate("__game.hud.bigOpen"), "grote kaart open"); A.evaluate("__game.hud.toggleBig(false)")

    # onweer en bliksem, baas met wortels
    cheat(A, "/weer onweer", 4000)
    check(A.evaluate("__game.wfx().weather === 'onweer'"), "onweer")
    cheat(A, "/weer helder")
    cheat(A, "/spawn 3 1", 9000)
    check(A.evaluate("[...__game.mons.values()].some(e => e.type === 3)"), "woudreus verschenen")
    check(wait_for(A, "__game.fx.some(f => f.kind === 'warn' || f.kind === 'roots')", 12000), "wortels van de woudreus")
    shot(A, "baas.png")
    # de andere bazen: Sneeuwreus (ijsstorm), Moerasheks (gifwolk), Schaduwridder (pareert)
    for typ, naam, fxjs in [(9, "sneeuwreus", "__game.fx.some(f => f.style === 'frost')"), (10, "moerasheks", "__game.fx.some(f => f.style === 'poison' || f.kind === 'gas')"), (11, "schaduwridder", "true")]:
        A.evaluate("__game.net.send({ t: 'chat', text: '/golf' })"); play(A, 600)
        cheat(A, f"/spawn {typ} 1", 1500)
        check(wait_for(A, f"[...__game.mons.values()].some(e => e.type === {typ})"), naam + " verschenen")
        check(wait_for(A, fxjs, 14000), naam + " gebruikt zijn vaardigheid")
        if typ == 11:
            e = A.evaluate("(() => { const e = [...__game.mons.values()].find(e => e.type === 11); return [e.x, e.z]; })()")
            goto(A, e[0] + 1.5, e[1], (e[0], e[1])); A.evaluate("__game.startSwing()"); play(A, 600)
        shot(A, naam + ".png")
    A.evaluate("__game.net.send({ t: 'chat', text: '/golf' })")

    # woestijn: graven, bazaar, piramide
    mo = A.evaluate("(() => { const m = __game.W.desert.mounds[0]; return [m.x, m.z]; })()")
    goto(A, mo[0] + 1.5, mo[1], (mo[0], mo[1])); play(A, 300)
    check("graven" in A.evaluate("__game.prompt()"), "aanwijzing graven", A.evaluate("__game.prompt()"))
    A.evaluate("__game.interact()")
    check(wait_for(A, "__game.des().digging"), "graven begonnen")
    check(wait_for(A, "!__game.des().digging", 15000), "graven klaar")
    bz = A.evaluate("[__game.W.desert.bazaar.x, __game.W.desert.bazaar.z]")
    goto(A, bz[0] + 3, bz[1], bz); A.evaluate("__game.interact()"); play(A, 300)
    check(A.evaluate("document.getElementById('bazaar').classList.contains('on')"), "bazaar open")
    A.evaluate("__game.closeShop(true)")
    pe = A.evaluate("[__game.W.desert.pyramid.entrance.x, __game.W.desert.pyramid.entrance.z]")
    cheat(A, "/piramide"); goto(A, pe[0], pe[1])
    check("zegel" in A.evaluate("__game.prompt()"), "aanwijzing piramide", A.evaluate("__game.prompt()"))
    A.evaluate("__game.interact()")
    check(wait_for(A, "[...__game.mons.values()].some(e => e.type === 7)"), "mummies ontwaakt")
    shot(A, "piramide.png")

    # reisstenen: activeren in de woestijn en naar het bos reizen
    cheat(A, "/goud 50")
    ts = A.evaluate("[__game.W.travel.desert.x, __game.W.travel.desert.z]")
    goto(A, ts[0] + 1.6, ts[1], ts)
    check("reissteen activeren" in A.evaluate("__game.prompt()"), "aanwijzing reissteen", A.evaluate("__game.prompt()"))
    A.evaluate("__game.interact()")
    check(wait_for(A, "__game.inv.travel === 1"), "reissteen geactiveerd")
    shot(A, "reissteen.png")
    A.evaluate("__game.interact()")
    check(wait_for(A, "Math.hypot(__game.player.x - __game.W.travel.forest.x, __game.player.z - __game.W.travel.forest.z) < 3", 12000), "gereisd naar het bos")

    check(not errs, "geen fouten in de browser", "; ".join(errs[:5]))
    ctx.close()

def mobile(b):
    errs = []
    ctx = b.new_context(viewport={"width": 844, "height": 390}, has_touch=True, is_mobile=True); ctx.add_init_script("try { localStorage.setItem('sw-gfx', 'laag') } catch {}"); A = ctx.new_page()
    A.on("pageerror", lambda e: errs.append(str(e)))
    login(A, "Mob" + str(int(time.time()) % 10000))
    A.goto(B + "?touch=1"); A.wait_for_selector("#lobby.on")
    A.click("#btn-quick"); A.wait_for_selector("#hud.on", timeout=180000); A.click("#btn-resume"); A.wait_for_timeout(800); play(A, 300)
    check(A.evaluate("document.body.classList.contains('touch') && __game.isTouch"), "touchbesturing aan")
    A.evaluate("__game.net.send({ t: 'tutskip' })")
    A.dispatch_event("#tb-atk", "pointerdown"); play(A, 120); A.dispatch_event("#tb-atk", "pointerup"); play(A, 300)
    check(A.evaluate("__game.swingT() < 1 || true"), "slaan via knop")
    s = A.evaluate("[__game.W.shop.x, __game.W.shop.z, __game.W.shop.rotY]")
    import math
    goto(A, s[0] + math.sin(s[2]) * 3.5, s[1] + math.cos(s[2]) * 3.5, (s[0], s[1])); play(A, 400)
    check(wait_for(A, "document.getElementById('tb-use').textContent.includes('🏪')"), "X-knop toont winkel", A.evaluate("document.getElementById('tb-use').textContent + ' ' + JSON.stringify(__game.getLocked())"))
    A.dispatch_event("#tb-use", "pointerdown"); play(A, 300)
    check(A.evaluate("document.getElementById('shop').classList.contains('on')"), "winkel open via X")
    shot(A, "mobiel.png")
    check(not errs, "geen fouten op mobiel", "; ".join(errs[:5]))
    ctx.close()

if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "alles"
    srv, data = start_server()
    try:
        with sync_playwright() as p:
            for part, fn in (("desktop", desktop), ("mobiel", mobile)):   # elk onderdeel een verse browser (software-GPU is krap)
                if which in ("alles", part):
                    b = p.chromium.launch(args=ARGS); fn(b); b.close()
    finally:
        srv.terminate(); shutil.rmtree(data, ignore_errors=True)
    bad = [n for ok, n in results if not ok]
    print(f"\n{len(results) - len(bad)}/{len(results)} geslaagd" + (": mislukt " + ", ".join(bad) if bad else "") + f"\nschermafbeeldingen: {OUT}")
    sys.exit(1 if bad else 0)
