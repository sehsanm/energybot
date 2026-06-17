import io
import pytest
from energybot.billing.barcode import decode_bill_barcode
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


def _zbar_available() -> bool:
    try:
        import pyzbar.pyzbar  # noqa: F401
        return True
    except Exception:
        return False


def test_decode_returns_none_for_garbage():
    assert decode_bill_barcode(b"not an image") is None


@pytest.mark.skipif(not _zbar_available(), reason="libzbar0 system library not installed")
def test_decode_reads_code128_bill_barcode():
    png = _make_barcode_png(_valid_pair())
    bn = decode_bill_barcode(png)
    assert bn is not None
    assert bn.bill_id == "117709580013" + _check_digit("117709580013")
