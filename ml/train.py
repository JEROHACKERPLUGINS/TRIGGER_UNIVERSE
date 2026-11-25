#!/usr/bin/env python3
"""TRIGGER UNIVERSE · train the pre-trained drum-type classifier and export it to C++.

  python3 train.py labels.tsv feat_*.csv  --out ../engine/DrumReplacer/DSP/PretrainedWeights.h

- Inputs: labels.tsv from names.py; feature CSVs from tu_features (the plugin's own analysis).
- Model: gradient-boosted trees (sklearn HistGradientBoosting, one tree per class per round,
  softmax). Beat MLPs of several sizes by ~5 points on held-out packs (75 % vs 70 %), and runs in
  C++ as plain comparisons.
- Honest evaluation: GroupKFold by PACK (top folders), so a pack is never in train and test
  at once (files of one pack sound alike and share names; mixing them would inflate the score).
  Compared against the rule-based classifier on the same files.
- Confidence threshold: the probability above which the model replaces the rules, chosen to
  maximise accuracy of "model if sure, else rules" on held-out packs.
- The final model is trained on everything and written as a header with the weights.
"""
import argparse
import collections
import sys

import numpy as np
from sklearn.metrics import confusion_matrix
from sklearn.model_selection import GroupKFold
from sklearn.ensemble import HistGradientBoostingClassifier

CLASSES = ["Kick", "Snare", "Clap", "HHC", "HHO", "Cymbal", "Tom", "Perc", "FX"]
NF = 58  # kRawFeatSize = 6 segs x 8 cepstrum + 1 log duration + 9 descriptors


def pack_of(path):
    parts = path.split("/")
    # the folder that holds the pack: skip generic containers ("Vengeance", "SPLICE/sounds/packs")
    generic = {"vengeance", "splice", "sounds", "packs", "01 - that sound", "maschine samples", "clasificar",
               "cymatics", "samples"}
    for p in parts[:-1]:
        if p.lower() not in generic:
            return p
    return parts[0]


def load(labels_path, feat_paths):
    lab = {}
    for line in open(labels_path, encoding="utf-8", errors="replace"):
        if line.startswith("id\t"):
            continue
        i, l, s, p = line.rstrip("\n").split("\t", 3)
        lab[int(i)] = (l, s, p)
    rows = {}
    for fp in feat_paths:
        for line in open(fp):
            v = line.rstrip("\n").split(",")
            if len(v) < 5 or v[1] != "1" or len(v) != 5 + NF:
                continue
            rows[int(v[0])] = (int(v[3]), float(v[4]), np.array(v[5:], dtype=np.float64))
    return lab, rows


def fit(X, y, seed, iters, leaves):
    return HistGradientBoostingClassifier(max_iter=iters, learning_rate=0.1, max_leaf_nodes=leaves,
                                          class_weight="balanced", random_state=seed).fit(X, y)


def proba_full(m, X):
    p = np.zeros((len(X), len(CLASSES)))
    p[:, m.classes_] = m.predict_proba(X)
    return p


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("labels")
    ap.add_argument("feats", nargs="+")
    ap.add_argument("--out", default="PretrainedWeights.h")
    ap.add_argument("--iters", type=int, default=300)
    ap.add_argument("--leaves", type=int, default=31)
    ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--report", default="train_report.md")
    ap.add_argument("--predict", default="predictions.tsv", help="model guess for every analysed file")
    a = ap.parse_args()

    lab, rows = load(a.labels, a.feats)
    ids = sorted(i for i in rows if i in lab and lab[i][0] in CLASSES)
    X = np.stack([rows[i][2] for i in ids])
    y = np.array([CLASSES.index(lab[i][0]) for i in ids])
    rule = np.array([rows[i][0] for i in ids])
    src = np.array([lab[i][1] for i in ids])
    groups = np.array([pack_of(lab[i][2]) for i in ids])
    print(f"{len(ids)} labelled + analysed files, {len(set(groups))} packs", file=sys.stderr)

    # ---- held-out evaluation by pack
    P = np.zeros((len(ids), len(CLASSES)))
    for k, (tr, te) in enumerate(GroupKFold(n_splits=a.folds).split(X, y, groups)):
        P[te] = proba_full(fit(X[tr], y[tr], k, a.iters, a.leaves), X[te])
        print(f"fold {k}: acc {np.mean(P[te].argmax(1) == y[te]):.3f}", file=sys.stderr)
    pred, conf = P.argmax(1), P.max(1)
    acc_model, acc_rule = np.mean(pred == y), np.mean(rule == y)

    # threshold: maximise accuracy of "model if conf >= t, else rules" (ties -> higher t)
    thr = max(np.arange(0., 1.0, 0.01), key=lambda t: (round(np.mean(np.where(conf >= t, pred, rule) == y), 4), t))
    thr = float(round(thr, 2))
    sure = conf >= thr
    final = np.where(sure, pred, rule)
    acc_final = np.mean(final == y)

    # ---- final model on everything
    m = fit(X, y, 99, a.iters, a.leaves)
    write_header(a.out, m, thr, len(ids), acc_model, acc_rule, acc_final)

    # ---- every analysed file (also unlabeled ones: CLASIFICAR, ...)
    all_ids = sorted(rows)
    Xa = np.stack([rows[i][2] for i in all_ids])
    Pa = proba_full(m, Xa)
    with open(a.predict, "w") as f:
        f.write("id\tlabel\tsource\tmodel\tprob\trules\tpath\n")
        for i, p in zip(all_ids, Pa):
            l, s, path = lab.get(i, ("", "?", ""))
            f.write(f"{i}\t{l}\t{s}\t{CLASSES[p.argmax()]}\t{p.max():.3f}\t{CLASSES[rows[i][0]]}\t{path}\n")

    cm = confusion_matrix(y, pred, labels=range(len(CLASSES)))
    with open(a.report, "w") as f:
        f.write(f"# Entrenamiento · {len(ids)} archivos etiquetados, {len(set(groups))} packs\n\n")
        f.write(f"Validación: {a.folds} folds agrupados por pack (ningún pack está en train y test a la vez).\n\n")
        f.write("| | precisión |\n|---|---:|\n")
        f.write(f"| Reglas actuales (SampleAnalysis.h) | {acc_rule:.1%} |\n")
        f.write(f"| Modelo pre-entrenado (siempre) | {acc_model:.1%} |\n")
        f.write(f"| Modelo si prob ≥ {thr:.2f}, si no reglas | {acc_final:.1%} |\n\n")
        f.write(f"Con prob ≥ {thr:.2f} decide el modelo en {sure.mean():.0%} de los archivos "
                f"y acierta {np.mean(pred[sure] == y[sure]):.1%}.\n\n")
        f.write("## Por tipo\n\n| Tipo | archivos | reglas | modelo |\n|---|---:|---:|---:|\n")
        for c, n in enumerate(CLASSES):
            s_ = y == c
            f.write(f"| {n} | {s_.sum()} | {np.mean(rule[s_] == c):.0%} | {np.mean(pred[s_] == c):.0%} |\n")
        f.write("\n## Matriz de confusión del modelo (fila = nombre, columna = modelo)\n\n")
        f.write("| | " + " | ".join(CLASSES) + " |\n|---|" + "---:|" * len(CLASSES) + "\n")
        for c, n in enumerate(CLASSES):
            f.write(f"| {n} | " + " | ".join(str(v) for v in cm[c]) + " |\n")
        # where name and audio disagree with high confidence: often a wrong name / folder
        wrong = np.where((pred != y) & (conf > 0.95))[0]
        f.write(f"\n## Nombre vs. audio en desacuerdo con prob > 0.95 ({len(wrong)})\n\n"
                "Suelen ser nombres o carpetas engañosos (o errores del modelo). Primeros 40:\n\n")
        for j in wrong[:40]:
            f.write(f"- {CLASSES[y[j]]} → modelo {CLASSES[pred[j]]} ({conf[j]:.2f}): `{lab[ids[j]][2]}`\n")
    print(open(a.report).read())


def write_header(path, m, thr, n, acc_model, acc_rule, acc_final):
    """Trees as one packed node array (12 bytes per node, depth-first order, so the left
    child of node i is always i + 1 and only the right child is stored).
    Inner node: go to i + 1 when x[feat] <= thr, else to right. Leaf: feat = -1, thr = value.
    Raw score of class k = base[k] + sum of the leaves reached in its trees."""
    K = len(m.classes_) if len(m.classes_) > 2 else 1
    nodes_out, roots, tcls = [], [], []
    for it in m._predictors:
        for k, tree in enumerate(it):
            nd = tree.nodes
            roots.append(len(nodes_out)); tcls.append(k)

            def emit(i):
                at = len(nodes_out)
                if nd[i]["is_leaf"]:
                    nodes_out.append([float(nd[i]["value"]), -1, 0])
                    return
                nodes_out.append([float(nd[i]["num_threshold"]), int(nd[i]["feature_idx"]), 0])
                emit(int(nd[i]["left"]))
                nodes_out[at][2] = len(nodes_out)
                emit(int(nd[i]["right"]))
            emit(0)
    basev = np.asarray(m._baseline_prediction).ravel()
    flt = lambda t: (lambda v: v if any(c in v for c in ".en") else v + ".")(f"{t:.9g}") + "f"
    node_text = "static const Node kNodes[kNumNodes] = {\n" + ",".join(
        f"{{{flt(t)},{ft},0,{r}}}" for t, ft, r in nodes_out) + "};\n\n}} // namespace tu::pretrained\n"
    import zlib
    ints = lambda v: ",".join(map(str, v))
    dbl = lambda v: ",".join(f"{x:.9g}" for x in v)
    with open(path, "w") as f:
        f.write("#pragma once\n// GENERATED by ml/train.py. Do not edit by hand.\n")
        f.write(f"// Gradient-boosted trees trained on {n} named samples. Held-out by pack: rules {acc_rule:.1%}, "
                f"model {acc_model:.1%}, model above threshold + rules {acc_final:.1%}.\n\n")
        f.write("#include <cstdint>\n\nnamespace tu { namespace pretrained {\n\n")
        f.write("struct Node { float thr; int16_t feat; int16_t pad; int32_t right; }; // leaf: feat -1, thr = value\n")
        f.write("constexpr bool kReady = true;\n")
        f.write(f"constexpr uint32_t kModelId = {zlib.crc32(node_text.encode())}u; "
                "// crc of the trees: stored with each file's result\n")
        f.write("constexpr int kTrainedAnalysisVersion = 5; // tu::kAnalysisVersion of the features\n")
        f.write(f"constexpr int kNumFeatures = {NF};\n")
        f.write(f"constexpr int kOut = {K};\n")
        f.write(f"constexpr int kClassOf[kOut] = {{{ints(m.classes_)}}}; // output -> EDrumClass\n")
        f.write(f"constexpr double kSure = {thr:.2f};\n")
        f.write(f"static const double kBase[kOut] = {{{dbl(basev)}}};\n")
        f.write(f"constexpr int kNumTrees = {len(roots)};\n")
        f.write(f"static const int32_t kRoot[kNumTrees] = {{{ints(roots)}}};\n")
        f.write(f"static const uint8_t kTreeClass[kNumTrees] = {{{ints(tcls)}}};\n")
        f.write(f"constexpr int kNumNodes = {len(nodes_out)};\n")
        f.write(node_text)


if __name__ == "__main__":
    main()
