"""Security violations: cryptography, authentication, and secrets."""
import hashlib
import ssl
import jwt
import random
from Crypto.Cipher import DES, AES
from cryptography.hazmat.primitives.asymmetric import rsa


# VIOLATION: security/deterministic/weak-hashing
digest = hashlib.md5(b"data")

# VIOLATION: security/deterministic/weak-hashing
digest2 = hashlib.sha1(b"data")


# VIOLATION: security/deterministic/weak-cipher
cipher = DES.new(b"12345678", DES.MODE_ECB)


# VIOLATION: security/deterministic/encryption-insecure-mode
ecb_cipher = AES.new(key, AES.MODE_ECB)


# VIOLATION: security/deterministic/weak-crypto-key
private_key = rsa.generate_private_key(
    public_exponent=65537,
    key_size=1024,
)


# VIOLATION: security/deterministic/weak-ssl
context = ssl.SSLContext(ssl.PROTOCOL_SSLv3)


# VIOLATION: security/deterministic/ssl-version-unsafe
context2 = ssl.SSLContext()
context2.minimum_version = ssl.TLSVersion.TLSv1


# VIOLATION: security/deterministic/ssl-no-version
context3 = ssl.SSLContext()


# VIOLATION: security/deterministic/insecure-jwt
token = jwt.encode({"user": "admin"}, "secret", algorithm="none")


# VIOLATION: security/deterministic/insecure-random
token_val = random.randint(0, 999999)
session_token = f"token-{token_val}"


# VIOLATION: security/deterministic/unverified-certificate
ctx = ssl._create_unverified_context()


# VIOLATION: security/deterministic/unverified-certificate
import requests
resp = requests.get("https://api.example.com", verify=False)


# VIOLATION: security/deterministic/unverified-hostname
ssl_ctx = ssl.SSLContext()
ssl_ctx.check_hostname = False


# VIOLATION: security/deterministic/flask-secret-key-disclosed
from flask import Flask
app = Flask(__name__)
app.secret_key = "super-secret-hardcoded-key"


# VIOLATION: security/deterministic/long-term-aws-keys-in-code
AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE"
AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
