import io
import pytest
from energybot.billing.pdf import decode_bill_from_pdf
from energybot.billing.bill_numbers import _check_digit


def _valid_pair() -> str:
    bill = "117709580013" + _check_digit("117709580013")
    pay = "015110129010" + _check_digit("015110129010")
    return bill + pay  # 26 digits


def _make_barcode_png(value: str) -> bytes:
    bc = pytest.importorskip("barcode")  # python-barcode, dev-only helper
    from barcode.writer import ImageWriter
    buf = io.BytesIO()
    bc.get("code128", value, writer=ImageWriter()).write(buf)
    return buf.getvalue()


def _png_to_pdf(png: bytes) -> bytes:
    from PIL import Image
    buf = io.BytesIO()
    Image.open(io.BytesIO(png)).convert("RGB").save(buf, format="PDF")
    return buf.getvalue()


def _fitz_available() -> bool:
    try:
        import fitz  # noqa: F401
        return True
    except Exception:
        return False


def _zbar_available() -> bool:
    try:
        import pyzbar.pyzbar  # noqa: F401
        return True
    except Exception:
        return False


def test_decode_returns_none_for_garbage():
    assert decode_bill_from_pdf(b"not a pdf") is None


@pytest.mark.skipif(not _fitz_available(), reason="PyMuPDF not installed")
def test_decode_returns_none_for_pdf_without_barcode():
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (200, 200), "white").save(buf, format="PDF")
    assert decode_bill_from_pdf(buf.getvalue()) is None


@pytest.mark.skipif(not (_fitz_available() and _zbar_available()),
                    reason="PyMuPDF or libzbar0 not installed")
def test_decode_reads_barcode_from_pdf():
    pdf = _png_to_pdf(_make_barcode_png(_valid_pair()))
    bn = decode_bill_from_pdf(pdf)
    assert bn is not None
    assert bn.bill_id == "117709580013" + _check_digit("117709580013")
