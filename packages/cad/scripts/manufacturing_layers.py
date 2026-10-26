"""Read fabrication contours with KiCad's own polygon engine (millimetres)."""
import argparse
import hashlib
import json
from pathlib import Path
import pcbnew

parser = argparse.ArgumentParser()
parser.add_argument('source', type=Path)
parser.add_argument('target', type=Path)
args = parser.parse_args()
board = pcbnew.LoadBoard(str(args.source))
error = 5000  # 5 micrometres; curve polygonisation, not guessed geometry.


def contours(poly):
    def points(chain):
        return [[pcbnew.ToMM(chain.CPoint(i).x), -pcbnew.ToMM(chain.CPoint(i).y)]
                for i in range(chain.PointCount())]
    return [{'outer': points(poly.COutline(i)),
             'holes': [points(poly.CHole(i, j)) for j in range(poly.HoleCount(i))]}
            for i in range(poly.OutlineCount())]


outline = pcbnew.SHAPE_POLY_SET()
if not board.GetBoardPolygonOutlines(outline, False):
    raise RuntimeError('KiCad could not obtain a closed board outline')
holes = pcbnew.SHAPE_POLY_SET()
pads = [p for f in board.GetFootprints() for p in f.Pads()]
for pad in pads:
    if pad.HasDrilledHole():
        pad.TransformHoleToPolygon(holes, 0, error, pcbnew.ERROR_INSIDE)
for track in board.GetTracks():
    if isinstance(track, pcbnew.PCB_VIA):
        if track.TopLayer() != pcbnew.F_Cu or track.BottomLayer() != pcbnew.B_Cu:
            raise RuntimeError('Blind/buried vias require layer-specific drill contours')
        hole = pcbnew.PAD(None)
        hole.SetPosition(track.GetPosition())
        hole.SetDrillSize(pcbnew.VECTOR2I(track.GetDrillValue(), track.GetDrillValue()))
        hole.TransformHoleToPolygon(holes, 0, error, pcbnew.ERROR_INSIDE)
holes.Simplify()
drilled = pcbnew.SHAPE_POLY_SET(outline)
drilled.BooleanSubtract(holes)
layers = {}
for name in ['F.Cu'] + [f'In{i}.Cu' for i in range(1, board.GetCopperLayerCount() - 1)] + ['B.Cu', 'F.Paste', 'B.Paste']:
    layer = board.GetLayerID(name)
    if layer < 0:
        continue
    poly = pcbnew.SHAPE_POLY_SET()
    for pad in pads:
        if pad.IsOnLayer(layer):
            # Paste preview only; final apertures use native SVG plotting.
            pad.TransformShapeToPolygon(poly, layer, 0, error, pcbnew.ERROR_INSIDE)
    if name.endswith('.Cu'):
        for track in board.GetTracks():
            if track.IsOnLayer(layer):
                track.TransformShapeToPolygon(poly, layer, 0, error, pcbnew.ERROR_INSIDE)
        for zone in board.Zones():
            if zone.IsOnLayer(layer):
                if not zone.HasFilledPolysForLayer(layer):
                    if not zone.GetIsRuleArea():
                        raise RuntimeError(f'Unfilled zone on {name}; refill in KiCad first')
                else:
                    poly.BooleanAdd(zone.GetFilledPolysList(layer))
        for item in list(board.GetDrawings()) + [g for f in board.GetFootprints() for g in f.GraphicalItems()]:
            if item.IsOnLayer(layer) and hasattr(item, 'TransformShapeToPolygon'):
                item.TransformShapeToPolygon(poly, layer, 0, error, pcbnew.ERROR_INSIDE)
    poly.Simplify()
    poly.BooleanIntersection(outline)
    poly.BooleanSubtract(holes)
    layers[name] = contours(poly)

report = {'schema': 1, 'input': str(args.source.resolve()),
          'sha256': hashlib.sha256(args.source.read_bytes()).hexdigest(),
          'engine': 'KiCad pcbnew ' + pcbnew.GetBuildVersion(), 'curveErrorMm': error / 1e6,
          'outline': contours(outline), 'drilled': contours(drilled), 'layers': layers,
          'footprints': {f.GetReference(): {'side': 'bottom' if f.IsFlipped() else 'top',
                         'mount': 'smd' if f.GetAttributes() & pcbnew.FP_SMD else 'through-hole' if f.GetAttributes() & pcbnew.FP_THROUGH_HOLE else 'other',
                         'position': [pcbnew.ToMM(f.GetPosition().x), -pcbnew.ToMM(f.GetPosition().y)]}
                         for f in board.GetFootprints()}}
args.target.write_text(json.dumps(report, separators=(',', ':')), encoding='utf-8')
print(json.dumps({'layers': {k: len(v) for k, v in layers.items()}, 'holes': holes.OutlineCount()}))
