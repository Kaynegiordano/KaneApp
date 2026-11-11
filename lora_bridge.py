"""Passerelle Kanevas -> entraineur de LoRA de Forge (extension forge_lora_trainer).

Lance par Kanevas avec le Python du venv de Forge :
    python lora_bridge.py <commande>     (arguments JSON sur stdin, reponse JSON sur stdout)

Reutilise lib_trainer tel quel : recettes et prereglages mesures, legendes WD14 (tagger d'ADetailer),
commande sd-scripts, suivi de progression. Ecrit dans les memes projets que l'onglet de Forge
(<data_dir>/lora_training/<nom>/), si bien qu'un projet commence ici se retrouve la-bas et inversement,
et qu'un Forge redemarre reprend un entrainement lance d'ici (run.json avec pid).

Seule difference voulue avec l'onglet de Forge : Forge n'est pas dans ce processus, il ne peut donc pas
reserver sa file de generation. Kanevas decharge le modele de Forge avant de lancer et l'utilisateur
en est averti.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import types
import uuid
from datetime import datetime, timezone
from pathlib import Path

LIB = None


def setup(a: dict):
    """Faux modules Forge minimaux (chemins), puis import de lib_trainer."""
    global LIB
    data = Path(a["data_dir"])
    models = Path(a.get("model_ref") or (data / "models"))
    mods = types.ModuleType("modules")
    pi = types.ModuleType("modules.paths_internal")
    pi.data_path = str(data)
    pi.extensions_dir = str(data / "extensions")
    pi.models_path = str(models)
    paths = types.ModuleType("modules.paths")
    paths.models_path = str(models)
    sh = types.ModuleType("modules.shared")
    sh.cmd_opts = types.SimpleNamespace(ckpt_dir=None, lora_dir=a.get("lora_dir") or str(models / "Lora"))
    sh.opts = types.SimpleNamespace(sd_model_checkpoint="", forge_additional_modules=a.get("modules") or [])
    mods.paths_internal, mods.paths, mods.shared = pi, paths, sh
    sys.modules.update({"modules": mods, "modules.paths_internal": pi, "modules.paths": paths, "modules.shared": sh})
    sys.path.insert(0, str(data / "extensions-builtin" / "forge_lora_trainer"))
    from lib_trainer import caption, presets, scopes, store, train  # noqa: E402
    LIB = types.SimpleNamespace(caption=caption, presets=presets, scopes=scopes, store=store, train=train,
                                lora_dir=Path(sh.cmd_opts.lora_dir), models=models)
    return LIB


# --------------------------------------------------------------------------- outils

def runs_of(name: str) -> list[Path]:
    root = LIB.store.dir_for(name) / "_training" / "runs"
    return sorted(root.glob("*/run.json"), reverse=True) if root.is_dir() else []


def run_state(run_file: Path) -> dict:
    """Etat d'un entrainement, qu'il ait ete lance par Forge ou par Kanevas."""
    t = LIB.train
    data = json.loads(run_file.read_text(encoding="utf-8"))
    pid = data.get("pid")
    running = isinstance(pid, int) and t.pid_alive(pid) and data.get("finished_at") is None
    output = Path(data["output"]) if data.get("output") else None
    code = data.get("return_code")
    if not running and code is None and data.get("finished_at") is None:
        # lance d'ici et termine : personne n'a releve son code ; le fichier final fait foi
        code = 0 if output and output.is_file() and output.stat().st_size > 0 else None
        data.update(return_code=code, finished_at=datetime.now(timezone.utc).isoformat())
        try:
            LIB.store.atomic_json(run_file, data)
        except Exception:
            pass
    log = run_file.parent / "train.log"
    info = t.read_progress(log, running, return_code=code, stopped=bool(data.get("stopped")), expected_output=output)
    if info["state"] == "error" and code == 0 and not (output and output.is_file()):
        info = {"state": "done", "pct": 100, "text": "Entraînement terminé (le fichier final a été déplacé ou renommé depuis)."}
    out_dir = output.parent if output else None
    ckpts, samples, epochs = [], [], []
    if out_dir and out_dir.is_dir():
        ckpts = [str(p) for p in sorted(out_dir.glob("*.safetensors"), key=lambda p: p.stat().st_mtime)]
        sdir = out_dir / "sample"
        pngs = sorted(sdir.glob("*.png"), key=lambda p: p.stat().st_mtime) if sdir.is_dir() else []
        samples = [str(p) for p in pngs][-12:]
        epochs = epoch_cards(out_dir, output, pngs, data)
    tail = ""
    if log.is_file():
        try:
            raw = log.read_text(encoding="utf-8", errors="replace").replace("\r", "\n")
            tail = "\n".join([l for l in raw.splitlines() if l.strip()][-8:])
        except Exception:
            pass
    return {"run": str(run_file.parent), "id": data.get("id"), "project": data.get("project"), "pid": pid,
            "running": running, "state": info["state"], "pct": info["pct"], "text": info["text"],
            "output": str(output) if output else "", "checkpoints": ckpts, "samples": samples, "tail": tail,
            "started_at": data.get("started_at"), "epochs": epochs, "token": data.get("token") or "",
            "before": [str(p) for p in pngs if re.search(r"_000000_\d{2}_", p.name)] if out_dir and out_dir.is_dir() else []}


def epoch_cards(out_dir: Path, output: Path | None, pngs: list, data: dict) -> list[dict]:
    """Une carte par sauvegarde : le fichier de l'époque et les images d'aperçu faites avec lui.

    sd-scripts nomme les sauvegardes <nom>-<époque:06d>.safetensors (la dernière : <nom>.safetensors) et les
    aperçus <nom>_e<époque:06d>_<n>_<date>.png : le numéro d'époque relie les deux.
    """
    by_epoch: dict[int, list[str]] = {}
    for p in pngs:
        m = re.search(r"_e(\d{6})_\d{2}_", p.name)
        if m:
            by_epoch.setdefault(int(m.group(1)), []).append(str(p))
    cards = []
    total = int((data.get("settings") or {}).get("epochs") or 0)
    for f in sorted(out_dir.glob("*.safetensors")):
        m = re.search(r"-(\d{6})$", f.stem)
        ep = int(m.group(1)) if m else (total or (max(by_epoch) if by_epoch else 0))
        cards.append({"epoch": ep, "path": str(f), "name": f.stem, "final": not m, "samples": by_epoch.get(ep, [])})
    cards.sort(key=lambda c: (c["epoch"], c["final"]))
    return cards


def effective_captions(name: str, threshold: float) -> tuple[dict, list]:
    s = LIB.store
    m = s.load(name)
    imgs = s.images_of(name)
    have = dict(m.get("captions", {}))
    missing = [p for p in imgs if not have.get(p.name)]
    failed = []
    if missing:
        fresh, failed = LIB.caption.caption_each(missing, threshold=float(threshold))
        have.update(fresh)
        m["captions"] = have
        s.save(name, m)
    return have, failed


EDITABLE = {"trigger", "steps", "epochs", "repeats", "resolution", "dim", "learning_rate", "threshold", "shuffle_caption",
            "network_dropout", "caption_dropout_rate", "lr_scheduler_num_cycles", "optimizer", "base_model", "scope",
            "rank_dropout", "module_dropout", "flip_aug", "multires", "lora_type", "captions", "sample_prompt", "sample_every", "recipe", "native_res"}


# --------------------------------------------------------------------------- commandes

def cmd_info(a):
    t, p = LIB.train, LIB.presets
    cands = []
    for root in (LIB.models / "Stable-diffusion", LIB.models / "diffusion_models"):
        if root.is_dir():
            cands += [str(x) for x in root.rglob("*.safetensors")]
    cands.sort(key=lambda c: (("anima" not in Path(c).name.lower()), t.dit_kind(c) != "base", Path(c).name.lower()))
    ok, why = LIB.caption.tagger_available()
    mods = list(a.get("modules") or [])
    if not mods:
        # Forge éteint : les fichiers d'anima à leur place habituelle
        for sub, pat in (("VAE", "*qwen*vae*.safetensors"), ("text_encoder", "qwen*.safetensors")):
            hits = [p for p in (LIB.models / sub).glob(pat)] if (LIB.models / sub).is_dir() else []
            # anima : Qwen3 0,6B (pas les gros Qwen-VL d'autres modèles)
            hits = [p for p in hits if "vl" not in p.name.lower()] or hits
            hits.sort(key=lambda p: (not any(t in p.name.lower() for t in ("06b", "0.6b", "0_6b")), p.stat().st_size))
            if hits:
                mods.append(str(hits[0]))
    vae = next((m for m in mods if "vae" in Path(m).name.lower()), "")
    qwen = next((m for m in mods if "vae" not in Path(m).name.lower() and any(k in Path(m).name.lower() for k in ("qwen", "text_encoder", "encoder", "llm"))), "")
    running = t.find_adoptable_run(max_log_age=10 ** 9)
    return {
        "sd_scripts": str(t.find_sd_scripts() or ""),
        "tagger": ok, "tagger_error": why,
        "presets": {k: {"label": v["label"], "hint": v.get("hint", "")} for k, v in p.PRESETS.items()},
        "scopes": {k: {"label": v.get("label", k), "hint": v.get("hint", ""), "summary": LIB.scopes.summary(k)} for k, v in LIB.scopes.SCOPES.items()},
        "scope_default": LIB.scopes.DEFAULT, "fewshot_max": p.FEWSHOT_MAX, "fewshot_resolutions": p.FEWSHOT_RESOLUTIONS,
        "optimizers": t.OPTIMIZERS,
        "dits": [{"path": c, "name": Path(c).name, "kind": t.dit_kind(c), "note": t.dit_note(c)} for c in cands],
        "dit": t.pick_default(cands), "vae": vae, "qwen3": qwen,
        "running": {"project": running["project"], "run": str(running["run_file"].parent), "pid": running["pid"]} if running else None,
        "resolutions": [512, 640, 768, 1024],
    }


def cmd_list(a):
    s = LIB.store
    out = []
    for name in s.list_projects():
        try:
            m = s.load(name)
        except Exception as exc:
            out.append({"name": name, "error": str(exc)})
            continue
        last = None
        rf = runs_of(name)
        if rf:
            try:
                last = run_state(rf[0])
                last = {k: last[k] for k in ("state", "pct", "running", "output", "run")}
            except Exception:
                last = None
        out.append({"name": name, "trigger": m.get("trigger", ""), "lora_type": m.get("lora_type", "style"),
                    "count": len(s.images_of(name)), "last": last})
    return {"projects": out}


def cmd_create(a):
    s = LIB.store
    name = s.unique_name(a.get("name") or "projet")
    m = s.default_manifest(name)
    if a.get("trigger"):
        m["trigger"] = s.sanitize(a["trigger"]).replace(" ", "_").lower()
    s.save(name, m)
    return {"name": name}


def cmd_load(a):
    s = LIB.store
    name = a["name"]
    m = s.load(name)
    previews = dict((label, path) for path, label in s.gallery_images(name))
    images = [{"file": p.name, "path": str(p), "preview": previews.get(p.name, "")} for p in s.images_of(name)]
    runs = []
    for rf in runs_of(name)[:6]:
        try:
            runs.append(run_state(rf))
        except Exception:
            pass
    note = LIB.presets.fewshot_note(m.get("lora_type", "style"), len(images)) if images else ""
    if images and m.get("lora_type") and int(m.get("recipe") or 1) < RECIPE:
        old = f"taux {float(m.get('learning_rate') or 0):.2g}, {int(m.get('repeats') or 0)} répétitions" if m.get("learning_rate") else "anciens réglages"
        note = ("**Réglages calculés avec l'ancienne recette** (" + old + ") : elle donnait des LoRA environ trois fois trop forts, "
                "qu'il fallait utiliser à 0,3. Cliquez **Appliquer le préréglage** pour les recalculer (plus court, prévu pour un poids de 1).") + ("\n\n" + note if note else "")
    return {"manifest": m, "images": images, "dir": str(s.dir_for(name)), "runs": runs, "note": note}


# Version des réglages calculés par les préréglages : 2 = recette recalibrée de KaneApp 1.29 (taux et passages plus bas,
# légendes dans l'ordre d'ANIMA, @déclencheur pour les styles). Un projet plus ancien est signalé à l'ouverture.
RECIPE = 2


def cmd_save(a):
    s = LIB.store
    m = s.load(a["name"])
    for k, v in (a.get("patch") or {}).items():
        if k in EDITABLE:
            m[k] = v
    if "trigger" in (a.get("patch") or {}):
        m["trigger"] = s.sanitize(m.get("trigger", "")).replace(" ", "_").lower()
    s.save(a["name"], m)
    return {"manifest": m}


def cmd_add(a):
    return {"added": LIB.store.add_images(a["name"], a.get("paths") or [])}


def cmd_import(a):
    s = LIB.store
    folder = (a.get("folder") or "").strip().strip('"')
    paths = a.get("paths") or []
    if not folder and not paths:
        raise ValueError("Indiquez un dossier, ou choisissez des images.")
    name = s.sanitize(a.get("new_name") or "") or a.get("name") or (s.sanitize(Path(folder).name) if folder else "") or s.unique_name("project")
    added = s.import_folder(name, folder) if folder else s.add_images(name, paths)
    if not added and not s.images_of(name):
        raise ValueError("aucune image prise en charge")
    s.save(name, s.load(name))
    return {"name": name, "added": added, "count": len(s.images_of(name))}


def cmd_remove(a):
    s = LIB.store
    d = s.dir_for(a["name"])
    m = s.load(a["name"])
    removed = 0
    for f in a.get("files") or []:
        p = d / Path(f).name
        if p.is_file() and p.suffix.lower() in s.IMAGE_EXTS:
            p.unlink()
            m.get("captions", {}).pop(p.name, None)
            removed += 1
    s.save(a["name"], m)
    return {"removed": removed}


def cmd_delete(a):
    return {"deleted": LIB.store.delete(a["name"])}


def cmd_caption(a):
    s = LIB.store
    name = a["name"]
    thr = float(a.get("threshold", 0.35))
    paths = s.images_of(name)
    if a.get("only_missing", True):
        caps, failed = effective_captions(name, thr)
        return {"captions": caps, "failed": failed}
    fresh, failed = LIB.caption.caption_each(paths, threshold=thr)
    m = s.load(name)
    m["captions"] = {**m.get("captions", {}), **fresh}
    m["threshold"] = thr
    s.save(name, m)
    return {"captions": m["captions"], "failed": failed}


def cmd_preset(a):
    s, p = LIB.store, LIB.presets
    name, kind = a["name"], (a.get("kind") or "style").lower()
    if kind not in p.PRESETS:
        raise ValueError(f"Préréglage inconnu : {kind}")
    images = s.images_of(name)
    if not images:
        raise ValueError("Ce projet n'a pas encore d'images.")
    try:
        caps, _failed = effective_captions(name, a.get("threshold", 0.35))
    except Exception as exc:
        print(f"[Kanevas] légendes automatiques indisponibles : {exc}")
        caps = s.load(name).get("captions", {})
    try:
        caps, rated = LIB.caption.add_safety(images, caps)      # anciennes légendes : la note de contenu d'ANIMA en tête
    except Exception as exc:
        print(f"[Kanevas] note de contenu indisponible : {exc}")
        rated = 0
    r = p.apply(kind, len(images), caps)
    multires = len(r["resolutions"]) > 1
    # Taille réelle des images pour les styles, si elles sont plus grandes que 1024² : le trait (hachures, grain, mèches)
    # s'apprend à l'échelle où l'on génère. Mesuré sur n1x3u à 1856x1024 : texture dessinée nettement mieux rendue,
    # pour environ 40 % de temps en plus. Les autres types n'en profitent pas assez pour ce prix.
    big = _median_area(images) > 1.1 * 1024 * 1024
    native = (kind in LIB.caption.ARTIST_LIKE) and big and not multires
    m = s.load(name)
    m.update(steps=r["steps"], epochs=r["epochs"], dim=r["dim"], repeats=r["repeats"], learning_rate=r["learning_rate"],
             resolution=r["resolution"], shuffle_caption=r["shuffle_caption"], lora_type=kind, captions=r["captions"],
             rank_dropout=r["rank_dropout"], module_dropout=r["module_dropout"], flip_aug=r["flip_aug"], multires=multires,
             caption_dropout_rate=r["caption_dropout_rate"], recipe=RECIPE, native_res=native)
    s.save(name, m)
    note = p.fewshot_note(kind, len(images))
    where = " x ".join(f"{x}px" for x in r["resolutions"]) if multires else ("taille réelle des images (jusqu'à 1536 px)" if native else f"{r['resolution']}px")
    pace = LIB.train.DEFAULT_PACE * 0.94 * (1.4 if native else 1.0)   # encodeur en cache : 1,39 s/pas ; taille réelle : 1,96
    status = (f"Préréglage **{p.PRESETS[kind]['label']}** pour {len(images)} image(s) : dimension {r['dim']}, "
              f"taux {r['learning_rate']:.2g}, {r['repeats']} répétitions × {r['epochs']} époques = {r['steps']} pas "
              f"en {where} ({r['passes_per_image']} passages par image), environ {max(1, round(r['steps'] * pace / 60))} min.")
    if r["few_shot"]:
        status += f" Dropout {r['rank_dropout']:.2f}{', images en miroir' if r['flip_aug'] else ''}."
    elif r["caption_dropout_rate"]:
        status += f" Légendes retirées au hasard : {r['caption_dropout_rate']:.0%}."
    token = LIB.caption.trigger_token(m.get("trigger") or "nom", kind)
    if token.startswith("@"):
        status += f" Dans vos invites, écrivez **{token}** (le « @ » des noms d'artiste d'ANIMA)."
    if rated:
        status += f" Note de contenu ANIMA (safe, sensitive, nsfw, explicit) ajoutée à {rated} légende(s)."
    if note:
        status += "\n\n" + note
    if r["removed_tags"]:
        more = "" if len(r["removed_tags"]) <= 12 else f" (+{len(r['removed_tags']) - 12} autres)"
        status += "\n\nRetirés des légendes pour se lier au déclencheur : " + ", ".join(r["removed_tags"][:12]) + more
    return {"manifest": m, "removed_tags": r["removed_tags"], "passes": r["passes_per_image"],
            "resolutions": r["resolutions"], "note": note, "status": status}


def _median_area(images) -> float:
    """Surface médiane des images (lecture des en-têtes seulement), 0 si illisible."""
    try:
        from PIL import Image
        areas = []
        for p in images[:200]:
            try:
                with Image.open(p) as im:
                    areas.append(im.size[0] * im.size[1])
            except Exception:
                pass
        areas.sort()
        return float(areas[len(areas) // 2]) if areas else 0.0
    except Exception:
        return 0.0


def cmd_start(a):
    s, t, p, sc = LIB.store, LIB.train, LIB.presets, LIB.scopes
    name = a["name"]
    running = t.find_adoptable_run(max_log_age=10 ** 9)
    if running:
        raise ValueError(f"Un entraînement tourne déjà (projet « {running['project']} »). Attendez sa fin ou arrêtez-le.")
    m = s.load(name)
    trigger = s.sanitize(m.get("trigger", "")).replace(" ", "_").lower()
    if not trigger:
        raise ValueError("Donnez un mot déclencheur : c'est le mot à écrire dans l'invite pour appeler le LoRA.")
    images = s.images_of(name)
    if not images:
        raise ValueError("Ce projet n'a pas encore d'images.")
    sd = t.find_sd_scripts()
    if sd is None:
        raise ValueError("sd-scripts (avec ANIMA) est introuvable à côté du dossier de Forge.")
    dit, qwen3, vae = a.get("dit") or m.get("base_model") or "", a.get("qwen3") or "", a.get("vae") or ""
    for label, path in (("modèle de diffusion", dit), ("encodeur Qwen3", qwen3), ("VAE", vae)):
        if not path or not Path(path).is_file():
            raise ValueError(f"Chemin du {label} vide ou introuvable : {path or '(vide)'}")
    m["trigger"], m["base_model"] = trigger, str(dit)
    s.save(name, m)

    caps, _failed = effective_captions(name, m.get("threshold", 0.35))
    epochs = int(m.get("epochs") or 0)
    repeats = int(m.get("repeats") or 10)
    resolution = int(m.get("resolution") or 1024)
    multires = bool(m.get("multires"))
    native = bool(m.get("native_res")) and not multires
    root = s.dir_for(name) / "_training"
    prev_log = Path(m["last_run_log"]) if m.get("last_run_log") else root / "train.log"
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S") + "-" + uuid.uuid4().hex[:8]
    work = root / "runs" / run_id
    kind = m.get("lora_type") or "style"
    token = LIB.caption.trigger_token(trigger, kind)
    subset, count = t.build_dataset(name, trigger, caps, repeats, work / "dataset", kind=kind)
    resolutions = list(p.FEWSHOT_RESOLUTIONS) if multires else [resolution]
    # Légendes dans l'ordre d'ANIMA, jamais mélangées : l'ordre a un sens pour le modèle, et des légendes fixes
    # permettent de garder l'encodeur de texte en cache (environ 12 % plus rapide, mesuré sur une RTX 5080).
    toml = t.write_dataset_toml(subset, resolution, 1, repeats, work / "dataset.toml",
                                shuffle=False, caption_dropout_rate=float(m.get("caption_dropout_rate", 0)),
                                resolutions=resolutions, flip_aug=bool(m.get("flip_aug")), native=native)
    sample_every = int(a.get("sample_every", m.get("sample_every", 250)) or 0)
    save_every = 1 if len(images) <= p.FEWSHOT_MAX else 2
    sample_file = None
    if sample_every > 0:
        sample_file = t.write_sample_prompts(sample_prompts(m, caps, token, kind, a.get("sample_prompt")), resolution,
                                             work / "sample_prompts.txt")
    per_epoch = max(1, count * repeats * len(resolutions))
    total = epochs * per_epoch if epochs > 0 else int(m.get("steps") or 2000)
    out_dir = (Path(a["output_dir"]) if a.get("output_dir") else LIB.lora_dir / "forge-mine") / s.sanitize(name) / run_id
    out_dir.mkdir(parents=True, exist_ok=True)
    scope = m.get("scope") if m.get("scope") in sc.SCOPES else sc.DEFAULT
    command = t.build_command(
        sd_scripts=sd, dit=Path(dit), qwen3=Path(qwen3), vae=Path(vae), dataset_toml=toml, output_dir=out_dir, output_name=trigger,
        settings={"max_train_steps": int(m.get("steps") or 2000), "max_train_epochs": epochs, "network_dim": int(m.get("dim") or 20),
                  "network_alpha": int(m.get("dim") or 20), "learning_rate": float(m.get("learning_rate") or 1e-4),
                  "optimizer": m.get("optimizer") if m.get("optimizer") in t.OPTIMIZERS else "adamw8bit",
                  "lr_warmup_steps": min(100, max(1, total // 20)), "network_dropout": float(m.get("network_dropout") or 0),
                  "lr_scheduler_num_cycles": int(m.get("lr_scheduler_num_cycles") or 1),
                  "save_every_n_epochs": save_every},
        sample_prompts=sample_file, sample_every_epochs=save_every if sample_file else 0, shuffle_caption=False, scope=scope,
        rank_dropout=float(m.get("rank_dropout") or 0), module_dropout=float(m.get("module_dropout") or 0))
    log = work / "train.log"
    pace = (t.measured_pace(prev_log) or t.DEFAULT_PACE) * (1.4 if native else 1.0)   # mesuré : 1,96 s/pas contre 1,39
    (work / "command.txt").write_text("\n".join(command), encoding="utf-8")
    record = {"id": run_id, "project": name, "started_at": datetime.now(timezone.utc).isoformat(), "settings": m,
              "command": command, "output": str(out_dir / f"{trigger}.safetensors"), "stopped": False, "pid": None,
              "launched_by": "kanevas", "token": token, "kind": kind}
    s.atomic_json(work / "run.json", record)
    proc = t.launch(command, cwd=sd, log_path=log)
    record["pid"] = proc.pid
    s.atomic_json(work / "run.json", record)
    m["last_run_log"] = str(log)
    s.save(name, m)
    return {"pid": proc.pid, "run": str(work), "total": total, "per_epoch": per_epoch, "resolutions": resolutions,
            "estimate_s": int(total * pace), "output": record["output"], "count": count, "token": token}


# Deux images d'aperçu par sauvegarde : une scène tirée du jeu d'images, une autre qui n'y est pas.
# La première dit si le LoRA a appris ; la seconde s'il sait faire autre chose que recopier ses images.
NEW_SCENE = {
    "style": "1girl, solo, {t}, upper body, looking at viewer, smile, outdoors, cherry blossoms, wind, day",
    "character": "1girl, solo, {t}, full body, standing, city street, night, neon lights",
    "concept": "1girl, solo, {t}, holding, indoors, table, window, day",
    "clothing": "1girl, solo, {t}, cowboy shot, standing, park, day",
    "background": "no humans, {t}, scenery, wide shot, day",
}


UNSAFE = {"nude", "completely nude", "nipples", "pussy", "penis", "sex", "nsfw", "explicit", "topless", "bottomless", "naked"}


def sample_prompts(m: dict, caps: dict, token: str, kind: str, asked: str | None) -> list[str]:
    asked = (asked or m.get("sample_prompt") or "").strip()
    if asked:
        return [asked if token.lstrip("@") in asked else f"{token}, {asked}"]
    cap = LIB.caption
    # seulement des légendes « safe » (ou sans note et sans tag explicite) : l'aperçu s'affiche dans l'atelier
    def tags_of(c):
        return {t.strip().lower() for t in c.split(",")}
    known = [c for c in caps.values() if c and ("safe" in tags_of(c) or not (tags_of(c) & (cap.SAFETY_TAGS | UNSAFE)))]
    first = ""
    if known:
        # la légende la plus « moyenne » du jeu : ni la plus courte ni la plus longue
        known.sort(key=lambda c: len(c.split(",")))
        tags = cap.anima_order(known[len(known) // 2], token).split(", ")
        first = ", ".join(tags[:24])
        if not tags_of(first) & cap.SAFETY_TAGS:
            first = "safe, " + first
    scene = NEW_SCENE.get(kind, NEW_SCENE["style"] if kind in cap.ARTIST_LIKE or kind in ("lighting", "weather", "effects", "composition") else "1girl, solo, {t}, upper body, outdoors, day")
    safety = "safe, "
    return [p for p in (first, safety + scene.format(t=token)) if p]


def cmd_install(a):
    """« Garder cette version » : copie une sauvegarde dans les LoRA (sous-dossier Anima s'il existe), avec sa fiche.

    Ne remplace jamais un fichier existant : un suffixe _2, _3… est ajouté.
    """
    import shutil
    src = Path(a["path"])
    if not src.is_file() or src.suffix.lower() != ".safetensors":
        raise ValueError("Fichier de LoRA introuvable : " + str(src))
    base = LIB.lora_dir / "Anima" if (LIB.lora_dir / "Anima").is_dir() else LIB.lora_dir
    stem = LIB.store.sanitize(a.get("name") or src.stem).replace(" ", "_") or "lora"
    dest, n = base / f"{stem}.safetensors", 2
    while dest.exists() or dest.with_suffix(".json").exists():
        dest, n = base / f"{stem}_{n}.safetensors", n + 1
    shutil.copyfile(src, dest)
    token = (a.get("token") or "").strip()
    sidecar = {"description": a.get("description") or "", "sd version": "Unknown", "activation text": token,
               "preferred weight": float(a.get("weight") or 1.0), "negative text": "", "notes": a.get("notes") or ""}
    dest.with_suffix(".json").write_text(json.dumps(sidecar, ensure_ascii=False, indent=4), encoding="utf-8")
    preview = Path(a["preview"]) if a.get("preview") else None
    if preview and preview.is_file():
        shutil.copyfile(preview, dest.with_suffix(".png"))
    return {"installed": str(dest), "name": dest.stem}


def cmd_status(a):
    if a.get("run"):
        return {"status": run_state(Path(a["run"]) / "run.json")}
    found = LIB.train.find_adoptable_run(max_log_age=10 ** 9)
    return {"status": run_state(found["run_file"]) if found else None}


def cmd_stop(a):
    rf = Path(a["run"]) / "run.json"
    data = json.loads(rf.read_text(encoding="utf-8"))
    pid = data.get("pid")
    if isinstance(pid, int) and LIB.train.pid_alive(pid):
        r = subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, timeout=20,
                           creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        if r.returncode and LIB.train.pid_alive(pid):
            raise RuntimeError("Arrêt non confirmé : " + r.stderr.decode(errors="replace"))
    data.update(stopped=True, finished_at=datetime.now(timezone.utc).isoformat())
    LIB.store.atomic_json(rf, data)
    return {"status": run_state(rf)}


def _image_name(pid: int) -> str:
    """Nom de l'executable d'un processus ('' si illisible : on ne conclut alors rien)."""
    if os.name != "nt":
        return ""
    import ctypes
    k32 = ctypes.windll.kernel32
    h = k32.OpenProcess(0x1000, False, pid)           # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return ""
    try:
        buf = ctypes.create_unicode_buffer(1024)
        size = ctypes.c_ulong(1024)
        return os.path.basename(buf.value).lower() if k32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size)) else ""
    finally:
        k32.CloseHandle(h)


def cmd_refresh(a):
    """« Actualiser » : remet d'aplomb l'etat des entrainements, pour pouvoir en relancer un.

    Un run.json non termine dont le processus n'existe plus (plantage, PC eteint) ou dont le PID a ete reattribue a un
    autre programme (Windows reutilise les PID) bloquait « Un entrainement tourne deja » et les generations de Kanevas.
    On le clot proprement ; un vrai entrainement en cours n'est jamais touche (le bouton Arreter sert a cela).
    """
    t = LIB.train
    fixed = []
    root = LIB.store.ROOT
    for rf in (sorted(root.glob("*/_training/runs/*/run.json")) if root.is_dir() else []):
        try:
            data = json.loads(rf.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if data.get("finished_at") is not None or data.get("stopped"):
            continue
        pid = data.get("pid")
        if not isinstance(pid, int):
            continue                                   # jamais demarre : find_adoptable_run l'ignore deja
        vivant = t.pid_alive(pid)
        raison = "le processus n'existe plus"
        if vivant:
            nom = _image_name(pid)
            if nom and nom not in ("python.exe", "pythonw.exe", "accelerate.exe", "py.exe"):
                vivant, raison = False, f"le PID {pid} est maintenant utilise par {nom}"
        if vivant:
            continue
        output = Path(data["output"]) if data.get("output") else None
        code = 0 if output and output.is_file() and output.stat().st_size > 0 else None
        data.update(return_code=code, finished_at=datetime.now(timezone.utc).isoformat(), stale=raison)
        try:
            LIB.store.atomic_json(rf, data)
            fixed.append({"project": data.get("project", ""), "run": str(rf.parent), "reason": raison})
        except Exception:
            pass
    found = t.find_adoptable_run(max_log_age=10 ** 9)
    status = run_state(found["run_file"]) if found else None
    idle = None
    if found:
        try:
            idle = int(time.time() - found["log"].stat().st_mtime)
        except OSError:
            pass
    return {"fixed": fixed, "status": status, "idle_s": idle}


COMMANDS = {k[4:]: v for k, v in globals().items() if k.startswith("cmd_")}


def main():
    out = sys.stdout
    sys.stdout = sys.stderr          # les bibliothèques écrivent sur stdout : la réponse JSON doit rester seule
    try:
        cmd = sys.argv[1]
        args = json.loads(sys.stdin.read() or "{}")
        setup(args)
        if cmd not in COMMANDS:
            raise ValueError(f"Commande inconnue : {cmd}")
        res = COMMANDS[cmd](args) or {}
        out.write(json.dumps({"ok": True, **res}, ensure_ascii=True, default=str))
    except Exception as exc:
        import traceback
        traceback.print_exc()
        out.write(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=True))
    out.flush()


if __name__ == "__main__":
    main()
