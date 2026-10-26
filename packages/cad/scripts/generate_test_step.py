"""Generate an explicit synthetic regression CAD source, never a PCB replacement."""
from pathlib import Path
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
from OCP.BRep import BRep_Builder
from OCP.TopoDS import TopoDS_Compound
from OCP.TDocStd import TDocStd_Document
from OCP.TCollection import TCollection_ExtendedString
from OCP.TDataStd import TDataStd_Name
from OCP.XCAFDoc import XCAFDoc_DocumentTool, XCAFDoc_ColorType
from OCP.Quantity import Quantity_Color, Quantity_TOC_RGB
from OCP.STEPCAFControl import STEPCAFControl_Writer
from OCP.STEPControl import STEPControl_AsIs
from OCP.TopLoc import TopLoc_Location
from OCP.gp import gp_Trsf, gp_Vec
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_FACE
from OCP.IFSelect import IFSelect_RetDone

doc = TDocStd_Document(TCollection_ExtendedString("BinXCAF"))
shapes = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
colors = XCAFDoc_DocumentTool.ColorTool_s(doc.Main())
box = BRepPrimAPI_MakeBox(10, 5, 2).Shape()
part = shapes.AddShape(box, False)
TDataStd_Name.Set_s(part, TCollection_ExtendedString("EXPLICIT_10x5x2"))
colors.SetColor(part, Quantity_Color(0.1, 0.6, 0.2, Quantity_TOC_RGB), XCAFDoc_ColorType.XCAFDoc_ColorSurf)
face = TopExp_Explorer(box, TopAbs_FACE).Current()
colors.SetColor(face, Quantity_Color(1, 0, 0, Quantity_TOC_RGB), XCAFDoc_ColorType.XCAFDoc_ColorSurf)
compound = TopoDS_Compound()
BRep_Builder().MakeCompound(compound)
assembly = shapes.AddShape(compound, True)
TDataStd_Name.Set_s(assembly, TCollection_ExtendedString("TWO_INSTANCES"))
shapes.AddComponent(assembly, part, TopLoc_Location())
translation = gp_Trsf()
translation.SetTranslation(gp_Vec(20, 3, -4))
shapes.AddComponent(assembly, part, TopLoc_Location(translation))
shapes.UpdateAssemblies()
writer = STEPCAFControl_Writer()
writer.SetColorMode(True)
writer.SetNameMode(True)
assert writer.Transfer(doc, STEPControl_AsIs)
target = Path(__file__).resolve().parents[3] / "fixtures" / "cad" / "colored-assembly.step"
assert writer.Write(str(target)) == IFSelect_RetDone
