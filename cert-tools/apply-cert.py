"""
宜泊慧智 C-AVP 证书申请脚本（DNS-01 手动加 TXT）

在本地向 Let's Encrypt 申请 parkinglot.c-avp.com 证书。
脚本会在需要时打印 TXT 记录并暂停，你手动在阿里云 DNS 后台添加，
回车后继续验证、签发、转 PKCS12。无需 AK/SK。

用法：
  python apply-cert.py   # 要求 CERT_EMAIL 可选
输出（cert-tools/out/）：
  fullchain.pem / privkey.pem / keystore.p12
"""
import os
import sys
import time

from cryptography import x509
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from acme import client as acme_client
from acme import messages
from acme import crypto_util as acme_crypto_util
import josepy

DOMAIN = "parkinglot.c-avp.com"
EMAIL = os.environ.get("CERT_EMAIL", "admin@parkinglot.c-avp.com")
ACME_DIR_URL = "https://acme-v02.api.letsencrypt.org/directory"
KEYSTORE_PWD = "changeit"
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    print(f"[1/6] 连接 ACME 并注册账号 ({EMAIL})...")
    acc_key = ec.generate_private_key(ec.SECP256R1())
    net = acme_client.ClientNetwork(acc_key, account=None)
    directory = messages.Directory.from_json(net.get(ACME_DIR_URL).json())
    client = acme_client.ClientV2(directory, net=net)

    try:
        regr = client.new_account(messages.NewRegistration.from_data(
            email=EMAIL, terms_of_service_agreed=True))
    except Exception:
        pass
    net.account = regr

    print("[2/6] 生成证书密钥对并创建订单...")
    domain_key = ec.generate_private_key(ec.SECP256R1())
    order = client.new_order(
        [messages.Identifier(typ=messages.IDENTIFIER_FQDN, value=DOMAIN)])
    authz = order.authorizations[0]

    chall = None
    for c in authz.body.challenges:
        if c.chall.typ == "dns-01":
            chall = c
            break
    if chall is None:
        print("[错误] 无 dns-01 challenge")
        sys.exit(1)

    key_auth = chall.response(domain_key)
    txt_value = key_auth.dns_challenge_response(DOMAIN)

    print("\n" + "=" * 60)
    print("  请在阿里云 DNS 后台手动添加以下 TXT 记录：")
    print("  ────────────────────────────────────────────")
    print(f"  类型  : TXT")
    print(f"  主机  : _acme-challenge.parkinglot")
    print(f"        (即 _acme-challenge.parkinglot.c-avp.com)")
    print(f"  记录值: {txt_value}")
    print(f"  TTL   : 600")
    print("  ────────────────────────────────────────────")
    print("  添加后等待约 60 秒再继续，确保 DNS 生效。")
    print("=" * 60)
    input("  添加完成并等待生效后，按回车继续...")

    print("\n[3/6] 通知 ACME 验证...")
    client.answer_challenge(chall, key_auth)

    deadline = time.time() + 180
    authz_updated = authz
    while time.time() < deadline:
        authz_updated = client.poll(authz)
        if authz_updated.body.status.name in ("valid", "invalid"):
            break
        time.sleep(5)
    if authz_updated.body.status.name != "valid":
        print(f"[错误] 验证失败: {authz_updated.body.status.name}")
        print("  请检查 TXT 记录是否正确添加、是否已生效。")
        sys.exit(1)
    print("  验证通过")

    print("[4/6] 生成 CSR 并请求签发...")
    domain_csr = acme_crypto_util.make_csr(domain_key, [DOMAIN])
    deadline = time.time() + 180
    order_updated = client.poll_and_request_issuance(order, domain_csr, deadline=deadline)

    cert_chain = client.fetch_order(order_updated.uri).fullchain_pem
    if isinstance(cert_chain, bytes):
        cert_chain = cert_chain.decode("utf-8")

    privkey_pem = domain_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")

    fullchain_path = os.path.join(OUT_DIR, "fullchain.pem")
    privkey_path = os.path.join(OUT_DIR, "privkey.pem")
    with open(fullchain_path, "w") as f:
        f.write(cert_chain)
    with open(privkey_path, "w") as f:
        f.write(privkey_pem)

    print("[5/6] 转 PKCS12...")
    p12_path = os.path.join(OUT_DIR, "keystore.p12")
    p12_bytes = serialization.pkcs12.serialize_key_and_certificates(
        name=b"cavp",
        key=domain_key,
        cert=x509.load_pem_x509_certificate(cert_chain.encode("utf-8")),
        cas=[],
        encryption_algorithm=serialization.BestAvailableEncryption(KEYSTORE_PWD.encode("utf-8")),
    )
    with open(p12_path, "wb") as f:
        f.write(p12_bytes)

    print(f"\n[6/6] 完成！输出目录 {OUT_DIR}")
    print(f"  fullchain.pem   证书链")
    print(f"  privkey.pem     私钥")
    print(f"  keystore.p12    PKCS12(密码 {KEYSTORE_PWD})，部署用")
    print("\n提示：证书 90 天到期，到期后重跑本脚本续期即可。")
    print("提示：可在阿里云删除刚才加的 TXT 记录。")


if __name__ == "__main__":
    main()
