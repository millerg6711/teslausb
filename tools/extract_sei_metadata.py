#!/usr/bin/env python3
"""
TeslaUSB SEI Metadata Extractor

Extracts vehicle telemetry (speed, GPS, steering, braking, autopilot state)
from Tesla dashcam clips and saves as JSON for evidence in disputes.

Usage:
    python3 extract_sei_metadata.py <video.mp4>              # Single file
    python3 extract_sei_metadata.py <directory>              # All clips in dir
    python3 extract_sei_metadata.py --summary <video.mp4>    # Quick summary
"""

import struct
import sys
import os
import json
from pathlib import Path
from typing import Generator, Optional, Tuple, List, Dict, Any
from datetime import datetime

# Try to import protobuf - provide instructions if missing
try:
    from google.protobuf.json_format import MessageToDict
    from google.protobuf.message import DecodeError
except ImportError:
    print("Error: protobuf not installed")
    print("Run: pip3 install protobuf")
    sys.exit(1)

# Try to import generated protobuf file
SCRIPT_DIR = Path(__file__).parent.parent / "dashcam"
sys.path.insert(0, str(SCRIPT_DIR))

try:
    import dashcam_pb2
except ImportError:
    print("Error: dashcam_pb2.py not found")
    print(f"Run: cd {SCRIPT_DIR} && protoc --python_out=. dashcam.proto")
    sys.exit(1)


def extract_sei_data(path: str) -> List[Dict[str, Any]]:
    """Extract all SEI metadata frames from a video file."""
    frames = []
    try:
        with open(path, "rb") as fp:
            offset, size = find_mdat(fp)
            for meta in iter_sei_messages(fp, offset, size):
                frame_data = MessageToDict(meta, preserving_proto_field_name=True)
                frames.append(frame_data)
    except Exception as e:
        print(f"Error processing {path}: {e}", file=sys.stderr)
    return frames


def get_summary(frames: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Generate a summary of the SEI data."""
    if not frames:
        return {"error": "No SEI data found"}
    
    speeds = [f.get("vehicle_speed_mps", 0) for f in frames if "vehicle_speed_mps" in f]
    lats = [f.get("latitude_deg") for f in frames if f.get("latitude_deg")]
    lons = [f.get("longitude_deg") for f in frames if f.get("longitude_deg")]
    headings = [f.get("heading_deg") for f in frames if f.get("heading_deg")]
    
    # Convert m/s to mph
    speeds_mph = [s * 2.237 for s in speeds if s is not None]
    
    # Get unique autopilot states
    ap_states = set(f.get("autopilot_state", "NONE") for f in frames)
    
    # Check if brakes were applied
    brakes_applied = any(f.get("brake_applied", False) for f in frames)
    
    # Get gear states
    gears = set(f.get("gear_state", "UNKNOWN") for f in frames)
    
    summary = {
        "total_frames": len(frames),
        "duration_approx_seconds": len(frames) / 36,  # ~36 fps
        "speed": {
            "max_mph": round(max(speeds_mph), 1) if speeds_mph else None,
            "min_mph": round(min(speeds_mph), 1) if speeds_mph else None,
            "avg_mph": round(sum(speeds_mph) / len(speeds_mph), 1) if speeds_mph else None,
        },
        "location": {
            "start_lat": lats[0] if lats else None,
            "start_lon": lons[0] if lons else None,
            "end_lat": lats[-1] if lats else None,
            "end_lon": lons[-1] if lons else None,
            "start_heading": round(headings[0], 1) if headings else None,
        },
        "brakes_applied": brakes_applied,
        "gear_states": list(gears),
        "autopilot_states": list(ap_states),
    }
    
    return summary


def process_file(video_path: str, output_json: bool = True, summary_only: bool = False) -> Dict:
    """Process a single video file."""
    print(f"Processing: {video_path}")
    
    frames = extract_sei_data(video_path)
    
    if not frames:
        print(f"  No SEI data found (may need firmware 2025.44.25+ and HW3+)")
        return {"file": video_path, "error": "No SEI data"}
    
    summary = get_summary(frames)
    
    if summary_only:
        print(f"  Frames: {summary['total_frames']}")
        print(f"  Duration: ~{summary['duration_approx_seconds']:.1f}s")
        if summary['speed']['max_mph']:
            print(f"  Speed: {summary['speed']['min_mph']}-{summary['speed']['max_mph']} mph (avg {summary['speed']['avg_mph']})")
        if summary['location']['start_lat']:
            print(f"  Location: {summary['location']['start_lat']:.6f}, {summary['location']['start_lon']:.6f}")
        print(f"  Brakes applied: {summary['brakes_applied']}")
        print(f"  Autopilot: {', '.join(summary['autopilot_states'])}")
        return summary
    
    # Save full data to JSON
    if output_json:
        json_path = video_path.rsplit('.', 1)[0] + '_sei.json'
        output = {
            "source_file": video_path,
            "extracted_at": datetime.now().isoformat(),
            "summary": summary,
            "frames": frames
        }
        with open(json_path, 'w') as f:
            json.dump(output, f, indent=2)
        print(f"  Saved: {json_path}")
    
    return summary


def process_directory(dir_path: str, summary_only: bool = False):
    """Process all MP4 files in a directory recursively."""
    results = []
    for root, dirs, files in os.walk(dir_path):
        for file in files:
            if file.lower().endswith('.mp4') and not file.startswith('.'):
                video_path = os.path.join(root, file)
                result = process_file(video_path, output_json=not summary_only, summary_only=summary_only)
                results.append({"file": video_path, **result})
    return results


# --- MP4 parsing functions (from Tesla's sei_extractor.py) ---

def iter_sei_messages(fp, offset: int, size: int):
    """Yield parsed SeiMetadata messages from the MP4 file."""
    for nal in iter_nals(fp, offset, size):
        payload = extract_proto_payload(nal)
        if not payload:
            continue
        meta = dashcam_pb2.SeiMetadata()
        try:
            meta.ParseFromString(payload)
        except DecodeError:
            continue
        yield meta


def extract_proto_payload(nal: bytes) -> Optional[bytes]:
    """Extract protobuf payload from SEI NAL unit."""
    if not isinstance(nal, bytes) or len(nal) < 2:
        return None
    for i in range(3, len(nal) - 1):
        byte = nal[i]
        if byte == 0x42:
            continue
        if byte == 0x69:
            if i > 2:
                return strip_emulation_prevention_bytes(nal[i + 1:-1])
            break
        break
    return None


def strip_emulation_prevention_bytes(data: bytes) -> bytes:
    """Remove emulation prevention bytes (0x03 following 0x00 0x00)."""
    stripped = bytearray()
    zero_count = 0
    for byte in data:
        if zero_count >= 2 and byte == 0x03:
            zero_count = 0
            continue
        stripped.append(byte)
        zero_count = 0 if byte != 0 else zero_count + 1
    return bytes(stripped)


def iter_nals(fp, offset: int, size: int) -> Generator[bytes, None, None]:
    """Yield SEI user NAL units from the MP4 mdat atom."""
    NAL_ID_SEI = 6
    NAL_SEI_ID_USER_DATA_UNREGISTERED = 5

    fp.seek(offset)
    consumed = 0
    while size == 0 or consumed < size:
        header = fp.read(4)
        if len(header) < 4:
            break
        nal_size = struct.unpack(">I", header)[0]
        if nal_size < 2:
            fp.seek(nal_size, 1)
            consumed += 4 + nal_size
            continue

        first_two = fp.read(2)
        if len(first_two) != 2:
            break

        if (first_two[0] & 0x1F) != NAL_ID_SEI or first_two[1] != NAL_SEI_ID_USER_DATA_UNREGISTERED:
            fp.seek(nal_size - 2, 1)
            consumed += 4 + nal_size
            continue

        rest = fp.read(nal_size - 2)
        if len(rest) != nal_size - 2:
            break
        payload = first_two + rest
        consumed += 4 + nal_size
        yield payload


def find_mdat(fp) -> Tuple[int, int]:
    """Return (offset, size) for the first mdat atom."""
    fp.seek(0)
    while True:
        header = fp.read(8)
        if len(header) < 8:
            raise RuntimeError("mdat atom not found")
        size32, atom_type = struct.unpack(">I4s", header)
        if size32 == 1:
            large = fp.read(8)
            if len(large) != 8:
                raise RuntimeError("truncated extended atom size")
            atom_size = struct.unpack(">Q", large)[0]
            header_size = 16
        else:
            atom_size = size32 if size32 else 0
            header_size = 8
        if atom_type == b"mdat":
            payload_size = atom_size - header_size if atom_size else 0
            return fp.tell(), payload_size
        if atom_size < header_size:
            raise RuntimeError("invalid MP4 atom size")
        fp.seek(atom_size - header_size, 1)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    
    summary_only = "--summary" in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    
    if not args:
        print("Error: No file or directory specified")
        sys.exit(1)
    
    target = args[0]
    
    if os.path.isfile(target):
        process_file(target, output_json=not summary_only, summary_only=summary_only)
    elif os.path.isdir(target):
        process_directory(target, summary_only=summary_only)
    else:
        print(f"Error: {target} not found")
        sys.exit(1)


if __name__ == "__main__":
    main()
