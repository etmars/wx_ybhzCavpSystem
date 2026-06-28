"""
自包含 ACMEv2 客户端（DNS-01 手动加 TXT）
不依赖 josepy/acme 库，手动实现 JWS，规避 Python 3.14 兼容问题。

申请 parkinglot.c-avp.com 证书，输出 PKCS12。
用法：python apply-cert.py
"""
import os
import sys
import json
import time
import base64
import hashlib
import requests
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.hazmat.primitives.asymmetric import ec


DOMAIN = "parkinglot.c-avp.com"
EMAIL = os.environ.get("CERT_EMAIL", "admin@parkinglot.c-avp.com")
# 用 staging 测试，跑通后改正式；正式地址保留在下方注释
ACME_URL = "https://acme-v02.api.letsencrypt.org/directory"
# ACME_URL = "https://acme-staging-v02.api.letsencrypt.org/directory"
KEYSTORE_PWD = "changeit"
OUT_DIR = ""


# ---------- base64url ----------
def b64u(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def b64u_s(s):
    return b64u(s.encode() if isinstance(s, str) else s)


# ---------- JWS (ES256) ----------
def jwk_from_key(key):
    """ES256 的 JWK：crv/x/y"""
    nums = key.public_key().public_numbers()
    x = nums.x.to_bytes(32, "big")
    y = nums.y.to_bytes(32, "big")
    return {"crv": "P-256", "kty": "EC", "x": b64u(x), "y": b64u(y)}


def jws_sign(payload, key, protected, kid=None):
    """手动构造 ACME JWS。payload/protected 都是 dict。"""
    if kid:
        protected["kid"] = kid
    else:
        protected["jwk"] = jwk_from_key(key)
    protected_b = json.dumps(protected, separators=(",", ":")).encode()
    if payload is None:
        payload_b = b""
    else:
        payload_b = json.dumps(payload, separators=(",", ":")).encode()
    signing_input = b64u(protected_b) + "." + b64u(payload_b)
    from cryptography.hazmat.primitives.asymmetric import utils
    der = key.sign(signing_input.encode(), ec.ECDSA(hashes.SHA256()))
    r, s = utils.decode_dss_signature(der)
    raw = r.to_bytes(32, "big") + s.to_bytes(32, "big")
    signature = b64u(raw)
    return {
        "protected": b64u(protected_b),
        "payload": b64u(payload_b),
        "signature": signature,
    }


class ACME:
    def __init__(self):
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.s = requests.Session()
        self.nonce = None
        self.kid = None
        self.dir = self._get(ACME_URL).json()

    def _get_nonce(self):
        if self.nonce is None:
            r = self.s.head(self.dir["newNonce"])
            self.nonce = r.headers["Replay-Nonce"]
        n = self.nonce
        self.nonce = None
        return n

    def _get(self, url):
        r = self.s.get(url, timeout=30)
        if "Replay-Nonce" in r.headers:
            self.nonce = r.headers["Replay-Nonce"]
        return r

    def _post(self, url, payload):
        protected = {"alg": "ES256", "nonce": self._get_nonce(), "url": url}
        body = jws_sign(payload, self.key, protected, kid=self.kid)
        r = self.s.post(url, json=body, headers={"Content-Type": "application/jose+json"}, timeout=30)
        if "Replay-Nonce" in r.headers:
            self.nonce = r.headers["Replay-Nonce"]
        if r.status_code >= 400:
            print(f"[HTTP {r.status_code}] {url}")
            print(r.text)
            r.raise_for_status()
        return r

    def register(self):
        payload = {"termsOfServiceAgreed": True, "contact": [f"mailto:{EMAIL}"]}
        r = self._post(self.dir["newAccount"], payload)
        self.kid = r.headers["Location"]
        print("    账号已注册:", self.kid)
        return r

    def new_order(self):
        payload = {"identifiers": [{"type": "dns", "value": DOMAIN}]}
        r = self._post(self.dir["newOrder"], payload)
        return r.json(), r.headers["Location"]

    def get(self, url):
        return self._get(url).json()

    def _key_auth(self, token):
        # keyAuthorization = token + "." + base64url(JWK_thumbprint)
        jwk = jwk_from_key(self.key)
        jwk_canon = json.dumps(jwk, separators=(",", ":"), sort_keys=True).encode()
        thumbprint = b64u(hashlib.sha256(jwk_canon).digest())
        return token + "." + thumbprint

    def answer_challenge(self, chall_url, token):
        key_auth = self._key_auth(token)
        self._post(chall_url, {})

    def dns_txt_value(self, token):
        key_auth = self._key_auth(token)
        return b64u(hashlib.sha256(key_auth.encode()).digest())


def main():
    global OUT_DIR
    OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
    os.makedirs(OUT_DIR, exist_ok=True)

    print(f"[1/6] 连接 ACME 并注册账号 ({EMAIL})...")
    acme = ACME()
    acme.register()

    print("[2/6] 创建订单...")
    order, order_url = acme.new_order()
    authz_url = order["authorizations"][0]
    authz = acme.get(authz_url)
    chall = None
    for c in authz["challenges"]:
        if c["type"] == "dns-01":
            chall = c
            break
    if not chall:
        print("[错误] 无 dns-01 challenge"); sys.exit(1)

    token = chall["token"]
    txt = acme.dns_txt_value(token)

    print("\n" + "=" * 60)
    print("  请在阿里云 DNS 后台手动添加以下 TXT 记录：")
    print("  ────────────────────────────────────────────")
    print(f"  类型  : TXT")
    print(f"  主机  : _acme-challenge.parkinglot")
    print(f"  记录值: {txt}")
    print(f"  TTL   : 600")
    print("  ────────────────────────────────────────────")
    print("  添加后等待约 60 秒再继续（确保 DNS 生效）。")
    print("=" * 60)
    input("  添加完成并等待生效后，按回车继续...")

    print("\n[3/6] 通知 ACME 验证...")
    acme.answer_challenge(chall["url"], token)

    # 轮询 authz
    deadline = time.time() + 180
    status = ""
    while time.time() < deadline:
        a = acme.get(authz_url)
        status = a["status"]
        if status in ("valid", "invalid"):
            break
        time.sleep(5)
    if status != "valid":
        print(f"[错误] 验证失败: {status}"); sys.exit(1)
    print("  验证通过")

    print("[4/6] 生成 CSR 并请求签发...")
    domain_key = ec.generate_private_key(ec.SECP256R1())
    csr = x509.CertificateSigningRequestBuilder().subject_name(
        x509.Name([x509.NameAttribute(x509.oid.NameOID.COMMON_NAME, DOMAIN)])
    ).add_extension(
        x509.BasicConstraints(ca=False, path_length=None), critical=True
    ).sign(domain_key, hashes.SHA256())
    der = csr.public_bytes(serialization.Encoding.DER)
    order = acme.get(order_url)
    finalize_url = order["finalize"]
    r = acme._post(finalize_url, {"csr": b64u(der)})
    order = r.json()

    deadline = time.time() + 180
    while time.time() < deadline and "certificate" not in order:
        time.sleep(3)
        order = acme.get(order_url)
    if "certificate" not in order:
        print("[错误] 签发超时:", order); sys.exit(1)

    cert_pem = acme.s.get(order["certificate"], timeout=30).text

    print("[5/6] 写入证书文件 + 转 PKCS12...")
    privkey_pem = domain_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,
        serialization.NoEncryption(),
    ).decode()

    with open(os.path.join(OUT_DIR, "fullchain.pem"), "w") as f:
        f.write(cert_pem)
    with open(os.path.join(OUT_DIR, "privkey.pem"), "w") as f:
        f.write(privkey_pem)

    cert_obj = x509.load_pem_x509_certificate(cert_pem.encode())
    # 解析完整链，把中间证书也放进 p12
    from cryptography.x509 import load_pem_x509_certificates
    try:
        all_certs = load_pem_x509_certificates(cert_pem.encode())
    except Exception:
        all_certs = [cert_obj]
    cas = all_certs[1:] if len(all_certs) > 1 else None
    p12 = pkcs12.serialize_key_and_certificates(
        name=b"cavp",
        key=domain_key,
        cert=cert_obj,
        cas=cas,
        encryption_algorithm=serialization.BestAvailableEncryption(KEYSTORE_PWD.encode()),
    )
    with open(os.path.join(OUT_DIR, "keystore.p12"), "wb") as f:
        f.write(p12)

    print(f"\n[6/6] 完成！输出目录 {OUT_DIR}")
    print("  fullchain.pem / privkey.pem / keystore.p12 (密码 changeit)")
    print("\n提示：可在阿里云删除刚才加的 TXT 记录。")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback
        traceback.print_exc()
        sys.exit(1)
