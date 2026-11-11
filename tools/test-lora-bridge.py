"""Contrats de l'atelier Lora (passerelle + lib_trainer), sans GPU ni projet réel.
Lancer avec le Python du venv du Studio :
    C:\\KaneOS\\KanevasData\\runtimes\\studio\\venv\\Scripts\\python.exe tools\\test-lora-bridge.py
Tout se passe dans un dossier temporaire : les projets et les LoRA de l'utilisateur ne sont jamais touchés.
"""
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import lora_bridge as B  # noqa: E402

DATA = Path(r"C:\KaneOS\KanevasData\runtimes\studio")
fails = 0
sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def check(ok, msg):
    global fails
    print(("OK " if ok else "ÉCHEC ") + msg)
    fails += 0 if ok else 1


tmp = Path(tempfile.mkdtemp(prefix="kanevas-lora-"))
(tmp / "Lora" / "Anima").mkdir(parents=True)
L = B.setup({"data_dir": str(DATA), "model_ref": r"C:\KaneOS\models", "lora_dir": str(tmp / "Lora")})  # modèles réels en lecture seule (tagger déjà là)
cap, pre, tr = L.caption, L.presets, L.train

# ordre ANIMA et déclencheur « @ »
check(cap.trigger_token("n1x3u", "style") == "@n1x3u" and cap.trigger_token("@n1x3u", "style") == "@n1x3u", "Style : déclencheur écrit @nom (préfixe d'artiste d'ANIMA)")
check(cap.trigger_token("m1ra", "character") == "m1ra", "Personnage : déclencheur sans @")
o = cap.anima_order("frieren, long hair, 1girl, solo, sensitive, white hair", "@n1x3u")
check(o.startswith("sensitive, 1girl, solo, frieren, @n1x3u, long hair"), "Ordre ANIMA : sécurité, compte, personnage, @déclencheur, le reste → " + o)
check(cap.anima_order("long hair, n1x3u, smile", "@n1x3u") == "@n1x3u, long hair, smile", "Un ancien déclencheur sans @ n'est pas répété")

# préréglages recalibrés
for kind in pre.PRESETS:
    d = pre.derive(kind, 24)
    if not (pre.LR_MIN <= d["learning_rate"] <= pre.LR_MAX and not d["shuffle_caption"]):
        check(False, f"{kind} : taux {d['learning_rate']} hors bande ou légendes mélangées")
d24 = pre.derive("style", 24)
check(d24["learning_rate"] <= 5e-5 and d24["passes_per_image"] <= 48, f"Style, 24 images : taux {d24['learning_rate']}, {d24['passes_per_image']} passages (avant : 9,5e-5 et 70)")
check(all(ord(c) < 0x2000 for v in pre.PRESETS.values() for c in v["label"]) and pre.PRESETS["concept"]["label"] == "Objet", "Noms des préréglages en français")

# jeu de données : légendes dans l'ordre ANIMA, @ pour un style
imgs = tmp / "imgs"; imgs.mkdir()
for n in ("a.png", "b.png"):
    (imgs / n).write_bytes(b"\x89PNG fake")
L.store.images_of = lambda name: sorted(imgs.iterdir())
subset, count = tr.build_dataset("p", "n1x3u", {"a.png": "smile, 1girl, safe", "b.png": ""}, 3, tmp / "ds", kind="style")
check(count == 2 and (subset / "a.txt").read_text(encoding="utf-8") == "safe, 1girl, @n1x3u, smile" and (subset / "b.txt").read_text(encoding="utf-8") == "@n1x3u",
      "Jeu de données : « safe, 1girl, @n1x3u, smile » ; image sans légende = déclencheur seul")
toml = tr.write_dataset_toml(subset, 1024, 1, 3, tmp / "ds.toml", shuffle=False).read_text(encoding="utf-8")
check("keep_tokens" not in toml and "shuffle_caption = false" in toml, "Légendes non mélangées : pas de keep_tokens")
nat = tr.write_dataset_toml(subset, 1024, 1, 3, tmp / "nat.toml", shuffle=False, native=True).read_text(encoding="utf-8")
check("resolution = [1536, 1536]" in nat and "bucket_no_upscale = true" in nat and "skip_image_resolution" not in nat, "Taille réelle : jusqu'à 1536², images jamais agrandies")
sp = tr.write_sample_prompts(["a, b", "c"], 1024, tmp / "s.txt").read_text(encoding="utf-8").splitlines()
check(len(sp) == 2 and "--w 832 --h 1216" in sp[0] and "--d 42" in sp[0] and "--d 43" in sp[1] and "--l 4" in sp[0], "Invites d'aperçu : 832×1216, CFG 4, une graine par ligne")
sd = tmp / "sd"; (sd / "venv" / "Scripts").mkdir(parents=True); (sd / "venv" / "Scripts" / "python.exe").write_bytes(b"")
cmd = tr.build_command(sd_scripts=sd, dit=Path("d"), qwen3=Path("q"), vae=Path("v"), dataset_toml=tmp / "ds.toml", output_dir=tmp, output_name="n1x3u",
                       settings={"max_train_epochs": 10}, sample_prompts=tmp / "s.txt", sample_every_epochs=2, shuffle_caption=False)
check("--sample_every_n_epochs=2" in cmd and "--sample_at_first" in cmd and "--cache_text_encoder_outputs" in cmd and not any("sample_every_n_steps" in c for c in cmd),
      "Commande : aperçus à chaque sauvegarde, encodeur de texte en cache")

# invites d'aperçu automatiques
ps = B.sample_prompts({}, {"a.png": "safe, 1girl, frieren, smile", "b.png": "safe, 1girl, long hair"}, "@n1x3u", "style", None)
check(len(ps) == 2 and all("@n1x3u" in p for p in ps) and "cherry blossoms" in ps[1], "Aperçus automatiques : une scène du jeu + une scène nouvelle, avec @n1x3u")
check(B.sample_prompts({"sample_prompt": "1girl, beach"}, {}, "@n1x3u", "style", None) == ["@n1x3u, 1girl, beach"], "Invite d'aperçu choisie : le déclencheur est ajouté s'il manque")

# préréglage conseillé parmi Style / Technique / Peinture numérique
base = ["1girl, solo, long hair, smile", "1girl, solo, short hair, sitting", "1boy, solo, armor", "1girl, solo, dress, outdoors", "1girl, solo, night"]
check(B.suggest_look({f"{i}.png": c for i, c in enumerate(base)})["kind"] == "style", "Conseillé : Style quand rien ne revient")
check(B.suggest_look({f"{i}.png": c + ", monochrome, greyscale" for i, c in enumerate(base)})["kind"] == "medium", "Conseillé : Technique quand « monochrome » est partout")
s2 = B.suggest_look({f"{i}.png": c + (", backlighting, depth of field, light particles" if i < 4 else "") for i, c in enumerate(base)})
check(s2["kind"] == "painterly" and "backlighting" in s2["why"], "Conseillé : Peinture numérique quand la même lumière revient (avec la raison)")
check(B.suggest_look({"a.png": "1girl", "b.png": "1boy"}) is None, "Pas de conseil avec moins de 4 légendes")

# cartes par époque
out = tmp / "run"; (out / "sample").mkdir(parents=True)
for f in ("n1x3u-000002.safetensors", "n1x3u-000004.safetensors", "n1x3u.safetensors"):
    (out / f).write_bytes(b"x")
for f in ("n1x3u_000000_00_20261111.png", "n1x3u_e000002_00_20261111.png", "n1x3u_e000002_01_20261111.png", "n1x3u_e000004_00_20261111.png", "n1x3u_e000006_00_20261111.png"):
    (out / "sample" / f).write_bytes(b"x")
cards = B.epoch_cards(out, out / "n1x3u.safetensors", sorted((out / "sample").glob("*.png")), {"settings": {"epochs": 6}})
check([(c["epoch"], c["final"], len(c["samples"])) for c in cards] == [(2, False, 2), (4, False, 1), (6, True, 1)], "Époques : 2 (2 images), 4, et la finale = époque 6 avec ses images")

# installation : jamais d'écrasement, fiche et image
(tmp / "Lora" / "Anima" / "n1x3u.safetensors").write_bytes(b"ancien")
r = B.cmd_install({"path": str(out / "n1x3u-000004.safetensors"), "name": "n1x3u", "token": "@n1x3u", "weight": 1, "preview": str(out / "sample" / "n1x3u_e000004_00_20261111.png")})
side = json.loads((tmp / "Lora" / "Anima" / "n1x3u_2.json").read_text(encoding="utf-8"))
check(r["name"] == "n1x3u_2" and (tmp / "Lora" / "Anima" / "n1x3u.safetensors").read_bytes() == b"ancien" and side["activation text"] == "@n1x3u" and side["preferred weight"] == 1.0
      and (tmp / "Lora" / "Anima" / "n1x3u_2.png").is_file(), "Garder une version : copiée en n1x3u_2 (l'existant intact), fiche @n1x3u poids 1, image")

import shutil
shutil.rmtree(tmp, ignore_errors=True)
print("Tout est bon" if not fails else f"{fails} échec(s)")
sys.exit(1 if fails else 0)
