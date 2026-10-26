"""STEP -> GLB using OpenCascade XCAF, retaining source assembly and colors.

No part classification, parametric replacement, model search or healing is used.
Meshes are computed on each definition, not on one large assembly compound.
"""
from __future__ import annotations

import argparse
import json
import importlib.metadata
from pathlib import Path

from OCP.BRep import BRep_Tool
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.Bnd import Bnd_Box
from OCP.IFSelect import IFSelect_RetDone
from OCP.Message import Message_ProgressRange
from OCP.RWGltf import RWGltf_CafWriter
from OCP.RWMesh import RWMesh_CoordinateSystem
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TCollection import TCollection_AsciiString, TCollection_ExtendedString
from OCP.TColStd import TColStd_IndexedDataMapOfStringString
from OCP.TDF import TDF_Label, TDF_LabelSequence, TDF_Tool
from OCP.TDocStd import TDocStd_Document
from OCP.TopAbs import TopAbs_FACE
from OCP.TopExp import TopExp_Explorer
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS
from OCP.XCAFDoc import XCAFDoc_DocumentTool, XCAFDoc_ShapeTool, XCAFDoc_VisMaterial, XCAFDoc_VisMaterialPBR
from OCP.XCAFPrs import XCAFPrs_Style


def label_id(label):
    entry = TCollection_AsciiString()
    TDF_Tool.Entry_s(label, entry)
    return entry.ToCString()


def convert(source: Path, target: Path, deflection: float):
    doc = TDocStd_Document(TCollection_ExtendedString("BinXCAF"))
    reader = STEPCAFControl_Reader()
    reader.SetColorMode(True)
    reader.SetNameMode(True)
    reader.SetMatMode(True)
    if reader.ReadFile(str(source)) != IFSelect_RetDone or not reader.Transfer(doc):
        raise RuntimeError("OpenCascade could not read/transfer the STEP document")
    shapes = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    roots = TDF_LabelSequence()
    shapes.GetFreeShapes(roots)
    if roots.IsEmpty():
        raise RuntimeError("STEP contains no free shapes")
    counts = {}
    definitions = 0
    faces = 0
    triangles = 0
    failed_faces = []

    def mesh_definition(label):
        nonlocal definitions, faces, triangles
        if XCAFDoc_ShapeTool.IsReference_s(label):
            referred = TDF_Label()
            if not XCAFDoc_ShapeTool.GetReferredShape_s(label, referred):
                raise RuntimeError("Broken STEP assembly reference")
            return mesh_definition(referred)
        identity = label_id(label)
        if identity in counts:
            return counts[identity]
        if XCAFDoc_ShapeTool.IsAssembly_s(label):
            children = TDF_LabelSequence()
            XCAFDoc_ShapeTool.GetComponents_s(label, children)
            count = 0
            for i in range(1, children.Length() + 1):
                count += mesh_definition(children.Value(i))
            counts[identity] = count
            return count
        shape = XCAFDoc_ShapeTool.GetShape_s(label)
        if shape.IsNull():
            raise RuntimeError(f"Null STEP shape at {identity}")
        mesher = BRepMesh_IncrementalMesh(shape, deflection, False, 0.25, True)
        if not mesher.IsDone():
            raise RuntimeError(f"Tessellation failed at {identity}")
        definitions += 1
        explorer = TopExp_Explorer(shape, TopAbs_FACE)
        face_index = 0
        count = 0
        while explorer.More():
            face = TopoDS.Face_s(explorer.Current())
            triangulation = BRep_Tool.Triangulation_s(face, TopLoc_Location())
            faces += 1
            if triangulation is None or triangulation.NbTriangles() == 0:
                failed_faces.append(f"{identity}/face{face_index}")
            else:
                triangles += triangulation.NbTriangles()
                count += triangulation.NbTriangles()
            face_index += 1
            explorer.Next()
        counts[identity] = count
        return count

    instance_triangles = sum(mesh_definition(roots.Value(i)) for i in range(1, roots.Length() + 1))
    if failed_faces:
        raise RuntimeError(f"{len(failed_faces)} STEP face(s) have no triangles; export stopped: {failed_faces[:20]}")
    if not triangles:
        raise RuntimeError("STEP contains no surface triangles")

    bounds = Bnd_Box()
    for i in range(1, roots.Length() + 1):
        BRepBndLib.AddOptimal_s(XCAFDoc_ShapeTool.GetShape_s(roots.Value(i)), bounds, False, False)
    if bounds.IsVoid():
        raise RuntimeError("STEP has no finite bounding box")
    coords = bounds.Get()
    writer = RWGltf_CafWriter(TCollection_AsciiString(str(target)), True)
    # STEP colors do not imply metal/plastic. Prevent glTF's implicit metalness=1
    # from turning every unassigned CAD surface into metal. This uniform viewing
    # material applies only when no source visual material is assigned.
    pbr = XCAFDoc_VisMaterialPBR()
    pbr.Metallic = 0.0
    pbr.Roughness = 0.65
    material = XCAFDoc_VisMaterial()
    material.SetPbrMaterial(pbr)
    style = XCAFPrs_Style()
    style.SetMaterial(material)
    writer.SetDefaultStyle(style)
    coordinates = writer.ChangeCoordinateSystemConverter()
    # Keep the PCB's XY plane / Z up, and write standard glTF metres.
    coordinates.SetInputCoordinateSystem(RWMesh_CoordinateSystem.RWMesh_CoordinateSystem_Zup)
    coordinates.SetOutputCoordinateSystem(RWMesh_CoordinateSystem.RWMesh_CoordinateSystem_Zup)
    coordinates.SetInputLengthUnit(0.001)
    coordinates.SetOutputLengthUnit(1.0)
    writer.SetMergeFaces(True)
    if not writer.Perform(doc, TColStd_IndexedDataMapOfStringString(), Message_ProgressRange()):
        raise RuntimeError("OpenCascade GLB writer failed")
    report = {
        "converter": "cadquery-ocp-novtk " + importlib.metadata.version("cadquery-ocp-novtk"),
        "definitions": definitions, "definitionFaces": faces,
        "definitionTriangles": triangles, "failedFaces": failed_faces,
        "instanceTriangles": instance_triangles,
        "cadBoundsMm": {"min": list(coords[:3]), "max": list(coords[3:]),
                        "size": [coords[i + 3] - coords[i] for i in range(3)]},
        "linearDeflectionMm": deflection, "angularDeflectionRad": 0.25,
        "modelUnits": "meter", "upAxis": "Z",
        "unspecifiedSurfaceResponse": {"metalness": 0, "roughness": 0.65},
    }
    target.with_suffix(".occt.json").write_text(json.dumps(report, indent=2), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path)
    parser.add_argument("--deflection", type=float, default=0.02)
    args = parser.parse_args()
    if not 0 < args.deflection <= 1:
        parser.error("Deflection must be > 0 and <= 1 mm")
    convert(args.source.resolve(), args.target.resolve(), args.deflection)
