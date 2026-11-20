#!/usr/bin/env python3
"""
100% Offline Human Facial Structure & Body Proportions Classifier.

Uses local ONNX & MediaPipe models cached inside python/models/:
  - InsightFace (buffalo_l): RetinaFace detection, ArcFace ResNet-50 512-D identity
    embeddings, 68-pt 3D / 5-pt facial geometry landmarks, and age/gender estimation.
  - MediaPipe PoseLandmarker (full): 33-pt 3D skeletal body landmarks for shoulder-to-hip
    taper, torso-to-limb proportions, and somatotype classification.
  - Scikit-Learn / NumPy: Offline pairwise biometric distance fusion and agglomerative
    identity clustering.

Supports both one-shot CLI (`analyze-batch`, `cluster`) and persistent `--worker`
JSON-lines mode so models stay warm in memory across 100+ image batches.
No external network calls or cloud API keys are used at runtime.
"""

from __future__ import annotations

import base64
import io
import json
import sys
import warnings
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import mediapipe as mp
import numpy as np
from insightface.app import FaceAnalysis
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision
from PIL import Image, ImageOps
from sklearn.cluster import AgglomerativeClustering

warnings.filterwarnings("ignore")

ROOT_DIR = Path(__file__).resolve().parent
MODELS_DIR = ROOT_DIR / "models"
INSIGHTFACE_ROOT = MODELS_DIR / "insightface"
POSE_MODEL_PATH = MODELS_DIR / "mediapipe" / "pose_landmarker_full.task"

_FACE_APP: Optional[FaceAnalysis] = None
_POSE_LANDMARKER: Optional[mp_vision.PoseLandmarker] = None


def get_face_analyzer() -> FaceAnalysis:
    global _FACE_APP
    if _FACE_APP is None:
        if not (INSIGHTFACE_ROOT / "models" / "buffalo_l").exists():
            raise RuntimeError(
                f"Offline InsightFace models missing at {INSIGHTFACE_ROOT / 'models' / 'buffalo_l'}"
            )
        app = FaceAnalysis(
            name="buffalo_l",
            root=str(INSIGHTFACE_ROOT),
            allowed_modules=["detection", "recognition", "landmark_3d_68", "genderage"],
            providers=["CPUExecutionProvider"],
        )
        app.prepare(ctx_id=-1, det_size=(640, 640), det_thresh=0.4)
        _FACE_APP = app
    return _FACE_APP


def get_pose_landmarker() -> mp_vision.PoseLandmarker:
    global _POSE_LANDMARKER
    if _POSE_LANDMARKER is None:
        if not POSE_MODEL_PATH.exists():
            raise RuntimeError(f"Offline MediaPipe pose model missing at {POSE_MODEL_PATH}")
        base_options = mp_python.BaseOptions(model_asset_path=str(POSE_MODEL_PATH))
        options = mp_vision.PoseLandmarkerOptions(
            base_options=base_options,
            running_mode=mp_vision.RunningMode.IMAGE,
            num_poses=1,
            min_pose_detection_confidence=0.4,
            min_pose_presence_confidence=0.4,
            min_tracking_confidence=0.4,
        )
        _POSE_LANDMARKER = mp_vision.PoseLandmarker.create_from_options(options)
    return _POSE_LANDMARKER


def decode_image_bgr(item: Dict[str, Any]) -> Tuple[np.ndarray, np.ndarray]:
    """Load an image from disk path or base64 payload, honoring EXIF orientation."""
    file_path = item.get("filePath")
    if file_path:
        with Image.open(file_path) as im:
            rgb_im = ImageOps.exif_transpose(im).convert("RGB")
            rgb = np.array(rgb_im, dtype=np.uint8)
    else:
        b64 = str(item.get("base64Data") or "")
        if "," in b64 and b64.startswith("data:"):
            b64 = b64.split(",", 1)[1]
        raw = base64.b64decode(b64)
        with Image.open(io.BytesIO(raw)) as im:
            rgb_im = ImageOps.exif_transpose(im).convert("RGB")
            rgb = np.array(rgb_im, dtype=np.uint8)

    # Cap ultra-large images cleanly on CPU while preserving crisp facial & pose geometry
    h, w = rgb.shape[:2]
    max_edge = max(h, w)
    if max_edge > 960:
        scale = 960.0 / max_edge
        rgb = cv2.resize(
            rgb,
            (max(1, int(round(w * scale))), max(1, int(round(h * scale)))),
            interpolation=cv2.INTER_AREA,
        )

    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    return rgb, bgr


def _dist(p1: np.ndarray, p2: np.ndarray) -> float:
    return float(np.linalg.norm(p1 - p2))


def _estimate_facial_hair(rgb: np.ndarray, face: Any) -> str:
    """Estimate jaw/chin facial hair presence from lower-face vs upper-cheek luminance."""
    bbox = np.array(face.bbox, dtype=np.int32)
    h, w = rgb.shape[:2]
    x1 = max(0, bbox[0])
    y1 = max(0, bbox[1])
    x2 = min(w, bbox[2])
    y2 = min(h, bbox[3])
    if x2 - x1 < 24 or y2 - y1 < 24:
        return "none"

    crop = rgb[y1:y2, x1:x2]
    ch, cw = crop.shape[:2]
    # Compare cheek skin brightness vs lower-chin / jaw brightness
    cheek = crop[int(ch * 0.42) : int(ch * 0.58), int(cw * 0.25) : int(cw * 0.75)]
    chin = crop[int(ch * 0.76) : int(ch * 0.94), int(cw * 0.28) : int(cw * 0.72)]
    if cheek.size == 0 or chin.size == 0:
        return "none"

    cheek_lum = float(np.mean(cheek))
    chin_lum = float(np.mean(chin))
    chin_std = float(np.std(chin))
    diff = cheek_lum - chin_lum
    if diff > 24.0 and chin_std > 18.0:
        return "full_or_short_beard"
    if diff > 13.0:
        return "light_stubble_contrast"
    return "clean_shaven_or_minimal"


def extract_facial_geometry(face: Any, rgb: np.ndarray) -> Tuple[Dict[str, str], List[float]]:
    """
    Compute anthropometric facial structure descriptors from InsightFace
    standard 68-pt landmarks (`landmark_3d_68`) or fallback 5-pt/bbox geometry.
    """
    lm68 = getattr(face, "landmark_3d_68", None)
    kps = getattr(face, "kps", None)
    bbox = np.array(face.bbox, dtype=np.float32)
    box_w = max(1.0, float(bbox[2] - bbox[0]))
    box_h = max(1.0, float(bbox[3] - bbox[1]))

    length_width_ratio = box_h / box_w
    jaw_cheek_ratio = 0.78
    chin_taper_ratio = 0.44
    forehead_ratio = 0.30
    eye_span_ratio = 0.45
    nose_index = 0.70

    if lm68 is not None and len(lm68) >= 68:
        pts = np.array(lm68[:, :2], dtype=np.float32)
        # Standard 68-pt indices:
        # 1..15 cheek/jaw contour; 4,12 jaw corners; 6,10 lower chin; 8 chin tip
        # 17..26 eyebrows; 27..35 nose; 36..47 eyes
        cheek_w = max(1.0, _dist(pts[1], pts[15]))
        temple_w = max(1.0, _dist(pts[0], pts[16]))
        jaw_w = max(1.0, _dist(pts[4], pts[12]))
        chin_w = max(1.0, _dist(pts[6], pts[10]))

        brow_y = float(np.mean(pts[17:27, 1]))
        chin_y = float(pts[8, 1])
        lower_h = max(1.0, chin_y - brow_y)
        # Anatomical rule of facial thirds: hairline sits ~0.34..0.38 above brow
        est_face_h = lower_h * 1.34

        length_width_ratio = est_face_h / cheek_w
        jaw_cheek_ratio = max(0.55, min(1.05, jaw_w / cheek_w))
        chin_taper_ratio = max(0.25, min(0.75, chin_w / cheek_w))
        forehead_ratio = max(0.22, min(0.40, (temple_w / cheek_w) * 0.28))

        eye_l = np.mean(pts[36:42], axis=0)
        eye_r = np.mean(pts[42:48], axis=0)
        eye_span_ratio = max(0.32, min(0.65, _dist(eye_l, eye_r) / cheek_w))

        nose_w = max(1.0, _dist(pts[31], pts[35]))
        nose_h = max(1.0, _dist(pts[27], pts[33]))
        nose_index = max(0.45, min(1.15, nose_w / nose_h))
    elif kps is not None and len(kps) >= 5:
        eye_l, eye_r, _, mouth_l, mouth_r = [np.array(p, dtype=np.float32) for p in kps[:5]]
        eye_span_ratio = _dist(eye_l, eye_r) / box_w
        jaw_cheek_ratio = (_dist(mouth_l, mouth_r) * 1.45) / box_w

    # Facial shape classification tuned across standard anthropometric ratios
    if length_width_ratio >= 1.38 and jaw_cheek_ratio >= 0.74:
        face_shape = "oblong"
    elif jaw_cheek_ratio >= 0.84 and length_width_ratio <= 1.28:
        face_shape = "square"
    elif length_width_ratio <= 1.21 and chin_taper_ratio >= 0.45:
        face_shape = "round"
    elif chin_taper_ratio <= 0.41 and jaw_cheek_ratio <= 0.77:
        face_shape = "heart"
    elif jaw_cheek_ratio <= 0.74 and length_width_ratio >= 1.24:
        face_shape = "diamond"
    else:
        face_shape = "oval"

    if jaw_cheek_ratio >= 0.85:
        jawline = "broad_angular"
    elif jaw_cheek_ratio >= 0.77:
        jawline = "defined_tapered"
    elif chin_taper_ratio <= 0.40:
        jawline = "narrow_tapered"
    else:
        jawline = "soft_rounded"

    if jaw_cheek_ratio <= 0.79 and chin_taper_ratio <= 0.45:
        cheekbones = "high_prominent"
    elif jaw_cheek_ratio >= 0.85:
        cheekbones = "broad_structured"
    else:
        cheekbones = "balanced_midface"

    if forehead_ratio >= 0.305:
        forehead_height = "high_broad"
    elif forehead_ratio <= 0.275:
        forehead_height = "compact"
    else:
        forehead_height = "medium_balanced"

    if eye_span_ratio >= 0.47:
        brow_and_eyes = "wide_set_balanced_brow"
    elif eye_span_ratio <= 0.42:
        brow_and_eyes = "close_set_focused_brow"
    else:
        brow_and_eyes = "proportional_set_eyes"

    if nose_index <= 0.68:
        nose_structure = "narrow_straight_bridge"
    elif nose_index >= 0.84:
        nose_structure = "broad_structured_bridge"
    else:
        nose_structure = "medium_straight_bridge"

    gender_val = getattr(face, "gender", None)
    age_val = getattr(face, "age", None)
    gender_label = "male" if gender_val == 1 else ("female" if gender_val == 0 else "adult")
    facial_marks = _estimate_facial_hair(rgb, face)

    geom_vector = [
        round(length_width_ratio / 1.5, 4),
        round(jaw_cheek_ratio, 4),
        round(chin_taper_ratio * 2.0, 4),
        round(eye_span_ratio * 2.0, 4),
        round(nose_index, 4),
    ]

    descriptors = {
        "faceShape": face_shape,
        "jawline": jawline,
        "cheekbones": cheekbones,
        "foreheadHeight": forehead_height,
        "browAndEyes": brow_and_eyes,
        "noseStructure": nose_structure,
        "facialHairOrMarks": facial_marks,
        "_gender": gender_label,
        "_age": str(int(round(age_val))) if isinstance(age_val, (int, float)) else "unknown",
    }
    return descriptors, geom_vector


def extract_body_proportions(
    rgb: np.ndarray, has_face: bool
) -> Tuple[bool, str, Dict[str, str], List[float]]:
    """
    Analyze skeletal body landmarks using MediaPipe PoseLandmarker (33 keypoints)
    in true pixel coordinates (eliminating aspect-ratio skew) and pelvic calibration.
    """
    landmarker = get_pose_landmarker()
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    result = landmarker.detect(mp_image)

    if not result.pose_landmarks or len(result.pose_landmarks) == 0:
        visibility = "headshot" if has_face else "no_human"
        return (
            False,
            visibility,
            {
                "somatotype": "upper_portrait_only" if has_face else "obscured",
                "shoulderToHipRatio": "cropped_above_torso" if has_face else "obscured",
                "statureAndLimbRatio": "head_and_neck_framing" if has_face else "obscured",
                "buildSummary": (
                    "Close portrait crop; skeletal lower body outside frame"
                    if has_face
                    else "No human skeletal pose detected"
                ),
            },
            [0.5, 0.5, 0.5, 0.5],
        )

    lm = result.pose_landmarks[0]
    img_h, img_w = rgb.shape[:2]

    def pt(idx: int) -> Tuple[np.ndarray, float]:
        p = lm[idx]
        vis = float(getattr(p, "visibility", 1.0) or 0.0)
        return np.array([float(p.x) * img_w, float(p.y) * img_h], dtype=np.float32), vis

    l_sh, v_ls = pt(11)
    r_sh, v_rs = pt(12)
    l_hip, v_lh = pt(23)
    r_hip, v_rh = pt(24)
    l_knee, v_lk = pt(25)
    r_knee, v_rk = pt(26)
    l_ankle, v_la = pt(27)
    r_ankle, v_ra = pt(28)
    l_wrist, v_lw = pt(15)
    r_wrist, v_rw = pt(16)

    shoulders_ok = v_ls > 0.35 and v_rs > 0.35
    hips_ok = v_lh > 0.30 and v_rh > 0.30
    legs_ok = (v_lk > 0.30 and v_la > 0.25) or (v_rk > 0.30 and v_ra > 0.25)

    if not (shoulders_ok or hips_ok):
        visibility = "headshot" if has_face else "no_human"
        return (
            False,
            visibility,
            {
                "somatotype": "upper_portrait_only" if has_face else "obscured",
                "shoulderToHipRatio": "cropped_above_torso" if has_face else "obscured",
                "statureAndLimbRatio": "head_and_neck_framing" if has_face else "obscured",
                "buildSummary": (
                    "Close portrait crop; shoulders/hips obscured"
                    if has_face
                    else "No human skeletal pose detected"
                ),
            },
            [0.5, 0.5, 0.5, 0.5],
        )

    shoulder_w = _dist(l_sh, r_sh) if shoulders_ok else img_w * 0.24
    raw_hip_joint_w = _dist(l_hip, r_hip) if hips_ok else shoulder_w * 0.62
    # MediaPipe landmarks 23/24 mark medial hip sockets inside the pelvic rim;
    # scale by 1.32 to match true outer iliac/hip breadth.
    hip_w = raw_hip_joint_w * 1.32

    sh_mid = (l_sh + r_sh) * 0.5
    hip_mid = (l_hip + r_hip) * 0.5
    torso_h = max(20.0, _dist(sh_mid, hip_mid)) if (shoulders_ok and hips_ok) else shoulder_w * 1.35

    sh_to_hip = max(0.75, min(1.85, shoulder_w / max(10.0, hip_w)))
    sh_to_torso = max(0.35, min(1.25, shoulder_w / torso_h))

    if legs_ok:
        visibility = "full_body"
        leg_len = max(
            _dist(l_hip, l_ankle) if (v_lh > 0.3 and v_la > 0.25) else 0.0,
            _dist(r_hip, r_ankle) if (v_rh > 0.3 and v_ra > 0.25) else 0.0,
        )
        leg_to_torso = max(0.8, min(2.3, leg_len / torso_h))
    elif hips_ok:
        visibility = "three_quarter_body"
        leg_to_torso = 1.45
    else:
        visibility = "upper_body"
        leg_to_torso = 1.40

    arm_span_est = shoulder_w
    if v_lw > 0.3 and v_ls > 0.3:
        arm_span_est += _dist(l_sh, l_wrist)
    if v_rw > 0.3 and v_rs > 0.3:
        arm_span_est += _dist(r_sh, r_wrist)
    arm_to_torso = max(0.8, min(2.8, arm_span_est / torso_h))

    if sh_to_hip >= 1.38:
        sh_hip_label = f"broad_v_taper ({sh_to_hip:.2f}x)"
    elif sh_to_hip >= 1.24:
        sh_hip_label = f"athletic_tapered ({sh_to_hip:.2f}x)"
    elif sh_to_hip >= 1.08:
        sh_hip_label = f"balanced_proportional ({sh_to_hip:.2f}x)"
    else:
        sh_hip_label = f"compact_hip_balanced ({sh_to_hip:.2f}x)"

    if sh_to_torso <= 0.63 and sh_to_hip <= 1.34:
        somatotype = "ectomorph"
    elif sh_to_hip >= 1.35 and sh_to_torso <= 0.76:
        somatotype = "mesomorph"
    elif sh_to_torso >= 0.77 and sh_to_hip <= 1.32:
        somatotype = "endomorph_mesomorph_blend"
    elif sh_to_hip >= 1.28:
        somatotype = "mesomorph_ectomorph_blend"
    else:
        somatotype = "balanced_mesomorph"

    if legs_ok:
        if leg_to_torso >= 1.62:
            limb_label = f"long_limbed_lean (leg/torso {leg_to_torso:.2f}x)"
        elif leg_to_torso <= 1.30:
            limb_label = f"compact_grounded (leg/torso {leg_to_torso:.2f}x)"
        else:
            limb_label = f"proportioned_stature (leg/torso {leg_to_torso:.2f}x)"
    else:
        limb_label = f"upper_frame_ratio (sh/torso {sh_to_torso:.2f}x)"

    summary = (
        f"{somatotype.replace('_', ' ')} build; shoulder/hip {sh_to_hip:.2f}x, "
        f"shoulder/torso {sh_to_torso:.2f}x ({visibility.replace('_', ' ')})"
    )

    body_vec = [
        round(min(1.0, sh_to_hip / 1.8), 4),
        round(min(1.0, sh_to_torso / 1.2), 4),
        round(min(1.0, leg_to_torso / 2.2), 4),
        round(min(1.0, arm_to_torso / 2.6), 4),
    ]

    return (
        True,
        visibility,
        {
            "somatotype": somatotype,
            "shoulderToHipRatio": sh_hip_label,
            "statureAndLimbRatio": limb_label,
            "buildSummary": summary,
        },
        body_vec,
    )


def analyze_single_image(item: Dict[str, Any]) -> Dict[str, Any]:
    image_id = str(item.get("imageId") or "")
    filename = str(item.get("filename") or image_id or "image.jpg")

    rgb, bgr = decode_image_bgr(item)
    face_app = get_face_analyzer()
    faces = face_app.get(bgr)

    faces_sorted = sorted(
        faces or [],
        key=lambda f: float(max(1.0, (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1])))
        * float(getattr(f, "det_score", 0.5)),
        reverse=True,
    )

    has_face = len(faces_sorted) > 0
    primary_face = faces_sorted[0] if has_face else None

    if primary_face is not None:
        face_desc, face_geom_vec = extract_facial_geometry(primary_face, rgb)
        raw_emb = getattr(primary_face, "normed_embedding", None)
        if raw_emb is None:
            emb = np.array(primary_face.embedding, dtype=np.float32)
            norm = float(np.linalg.norm(emb)) or 1.0
            raw_emb = emb / norm
        face_embedding = [round(float(x), 6) for x in raw_emb]
        face_det_score = float(getattr(primary_face, "det_score", 0.85))
    else:
        face_desc = {
            "faceShape": "obscured",
            "jawline": "obscured",
            "cheekbones": "obscured",
            "foreheadHeight": "obscured",
            "browAndEyes": "obscured",
            "noseStructure": "obscured",
            "facialHairOrMarks": "none",
            "_gender": "unknown",
            "_age": "unknown",
        }
        face_geom_vec = []
        face_embedding = []
        face_det_score = 0.0

    has_pose, visibility, body_desc, body_vec = extract_body_proportions(rgb, has_face)
    has_human = has_face or has_pose

    if not has_human:
        visibility = "no_human"

    gender_label = face_desc.pop("_gender", "unknown")
    age_val = face_desc.pop("_age", "unknown")
    age_range = "unknown"
    if age_val != "unknown":
        a = int(age_val)
        low = max(1, (a // 5) * 5)
        age_range = f"{low}-{low + 6}"

    confidence = (
        round(min(0.99, max(0.55, face_det_score * 0.98)), 3)
        if has_face
        else (0.68 if has_pose else 0.90)
    )

    signature = (
        f"{face_desc['faceShape']} face, {face_desc['jawline']} jaw, "
        f"{body_desc['somatotype']}, sh/hip {body_desc['shoulderToHipRatio']}"
        if has_human
        else "No human subject detected by offline face/pose models"
    )

    return {
        "imageId": image_id,
        "filename": filename,
        "hasHuman": bool(has_human),
        "faceCount": int(len(faces_sorted)),
        "visibility": visibility,
        "apparentPresentation": gender_label,
        "estimatedAgeRange": age_range,
        "facialStructure": face_desc,
        "bodyProportions": body_desc,
        "biometricSignature": signature,
        "confidence": confidence,
        "faceEmbedding": face_embedding,
        "faceGeometryVector": face_geom_vec,
        "bodyVector": body_vec,
    }


def cosine_sim(v1: np.ndarray, v2: np.ndarray) -> float:
    n1 = float(np.linalg.norm(v1))
    n2 = float(np.linalg.norm(v2))
    if n1 == 0.0 or n2 == 0.0:
        return 0.0
    return float(np.dot(v1, v2) / (n1 * n2))


def cluster_profiles_offline(profiles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Cluster extracted biometric profiles using fused offline similarity:
      - Primary signal: ArcFace 512-D facial embedding cosine similarity (w600k_r50)
      - Secondary verification: 68-pt facial geometry + MediaPipe skeletal body proportions
    """
    humans = [p for p in profiles if p.get("hasHuman")]
    n = len(humans)
    if n == 0:
        return []

    if n == 1:
        p = humans[0]
        return [
            {
                "displayName": f"Person ({p['facialStructure']['faceShape']}, {p['bodyProportions']['somatotype']})",
                "summary": p.get("biometricSignature", "Single detected individual"),
                "dominantFaceShape": p["facialStructure"]["faceShape"],
                "dominantSomatotype": p["bodyProportions"]["somatotype"],
                "matchRationale": f"Single image ({p['filename']}) classified offline via InsightFace ArcFace + MediaPipe Pose.",
                "confidence": float(p.get("confidence", 0.9)),
                "imageIds": [p["imageId"]],
            }
        ]

    dist_mat = np.ones((n, n), dtype=np.float32)
    np.fill_diagonal(dist_mat, 0.0)
    pair_sims: Dict[Tuple[int, int], float] = {}

    for i in range(n):
        emb_i = np.array(humans[i].get("faceEmbedding") or [], dtype=np.float32)
        geom_i = np.array(humans[i].get("faceGeometryVector") or [], dtype=np.float32)
        body_i = np.array(humans[i].get("bodyVector") or [], dtype=np.float32)
        pres_i = str(humans[i].get("apparentPresentation") or "unknown")

        for j in range(i + 1, n):
            emb_j = np.array(humans[j].get("faceEmbedding") or [], dtype=np.float32)
            geom_j = np.array(humans[j].get("faceGeometryVector") or [], dtype=np.float32)
            body_j = np.array(humans[j].get("bodyVector") or [], dtype=np.float32)
            pres_j = str(humans[j].get("apparentPresentation") or "unknown")

            if len(emb_i) > 0 and len(emb_j) > 0:
                arc_sim = cosine_sim(emb_i, emb_j)
                geom_sim = cosine_sim(geom_i, geom_j) if (len(geom_i) > 0 and len(geom_j) > 0) else 0.85
                body_sim = cosine_sim(body_i, body_j) if (len(body_i) > 0 and len(body_j) > 0) else 0.85

                combined_sim = 0.84 * arc_sim + 0.08 * geom_sim + 0.08 * body_sim

                if pres_i in ("male", "female") and pres_j in ("male", "female") and pres_i != pres_j:
                    if arc_sim < 0.45:
                        combined_sim *= 0.60

                if arc_sim >= 0.31:
                    dist = max(0.02, 0.55 - (combined_sim - 0.39) * 1.15)
                else:
                    dist = min(1.0, 0.72 + (0.31 - arc_sim) * 0.7)
            elif len(body_i) > 0 and len(body_j) > 0 and len(emb_i) == 0 and len(emb_j) == 0:
                body_diff = float(np.linalg.norm(body_i - body_j))
                dist = min(1.0, body_diff * 3.5)
                combined_sim = max(0.0, 1.0 - body_diff)
            else:
                dist = 0.98
                combined_sim = 0.05

            dist_mat[i, j] = dist_mat[j, i] = float(max(0.0, min(1.0, dist)))
            pair_sims[(i, j)] = float(combined_sim)

    clustering = AgglomerativeClustering(
        n_clusters=None,
        metric="precomputed",
        linkage="average",
        distance_threshold=0.55,
    )
    labels = clustering.fit_predict(dist_mat)

    grouped: Dict[int, List[int]] = {}
    for idx, lbl in enumerate(labels):
        grouped.setdefault(int(lbl), []).append(idx)

    clusters_out: List[Dict[str, Any]] = []
    for _, member_indices in sorted(grouped.items(), key=lambda kv: kv[1][0]):
        members = [humans[idx] for idx in member_indices]
        face_shapes = [m["facialStructure"]["faceShape"] for m in members if m["facialStructure"]["faceShape"] != "obscured"]
        somatotypes = [m["bodyProportions"]["somatotype"] for m in members if m["bodyProportions"]["somatotype"] not in ("obscured", "upper_portrait_only")]

        dom_face = max(set(face_shapes), key=face_shapes.count) if face_shapes else members[0]["facialStructure"]["faceShape"]
        dom_body = max(set(somatotypes), key=somatotypes.count) if somatotypes else members[0]["bodyProportions"]["somatotype"]

        avg_conf = float(np.mean([m.get("confidence", 0.85) for m in members]))
        if len(member_indices) > 1:
            sims = [
                pair_sims.get((min(a, b), max(a, b)), 0.5)
                for idx_a, a in enumerate(member_indices)
                for b in member_indices[idx_a + 1 :]
            ]
            avg_sim = float(np.mean(sims)) if sims else 0.75
            names = ", ".join(m["filename"] for m in members[:5])
            if len(members) > 5:
                names += f" (+{len(members) - 5} more)"
            rationale = (
                f"Matched {len(members)} images ({names}) offline via ArcFace 512-D facial embedding "
                f"(mean similarity {avg_sim * 100:.0f}%), {dom_face} facial contour, and {dom_body.replace('_', ' ')} body frame."
            )
            conf = min(0.99, max(0.75, 0.55 + avg_sim * 0.55))
        else:
            m = members[0]
            rationale = (
                f"Unique individual in {m['filename']} — distinct {dom_face} face shape, "
                f"{m['facialStructure']['jawline'].replace('_', ' ')} jawline, and {dom_body.replace('_', ' ')} build."
            )
            conf = avg_conf

        clusters_out.append(
            {
                "displayName": f"Person ({dom_face}, {dom_body.replace('_', ' ')})",
                "summary": f"{dom_face.title()} facial structure with {dom_body.replace('_', ' ')} proportions ({len(members)} photo{'s' if len(members) != 1 else ''}).",
                "dominantFaceShape": dom_face,
                "dominantSomatotype": dom_body,
                "matchRationale": rationale,
                "confidence": round(conf, 3),
                "imageIds": [m["imageId"] for m in members],
            }
        )

    return clusters_out


def handle_command(cmd: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    if cmd == "analyze-batch":
        images = payload.get("images") or []
        return {"profiles": [analyze_single_image(item) for item in images]}
    if cmd == "cluster":
        profiles = payload.get("profiles") or []
        return {"clusters": cluster_profiles_offline(profiles)}
    if cmd == "ping":
        get_face_analyzer()
        get_pose_landmarker()
        return {"status": "ready"}
    raise ValueError(f"Unknown command: {cmd}")


def run_worker_loop() -> None:
    # Preload models once at worker startup so every request is immediate
    get_face_analyzer()
    get_pose_landmarker()
    for line in sys.stdin:
        text = line.strip()
        if not text:
            continue
        req_id = None
        try:
            msg = json.loads(text)
            req_id = msg.get("id")
            cmd = str(msg.get("cmd") or "")
            payload = msg.get("payload") or {}
            result = handle_command(cmd, payload)
            sys.stdout.write(json.dumps({"id": req_id, "ok": True, "data": result}) + "\n")
            sys.stdout.flush()
        except Exception as exc:  # noqa: BLE001
            sys.stdout.write(json.dumps({"id": req_id, "ok": False, "error": str(exc)}) + "\n")
            sys.stdout.flush()


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing command: analyze-batch | cluster | --worker"}))
        sys.exit(1)

    cmd = sys.argv[1]
    if cmd == "--worker":
        run_worker_loop()
        return

    raw_input = sys.stdin.read()
    payload = json.loads(raw_input) if raw_input.strip() else {}
    print(json.dumps(handle_command(cmd, payload)))


if __name__ == "__main__":
    main()
