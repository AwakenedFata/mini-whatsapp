// EDUCATIONAL E2EE DEMO.
// This is NOT a production implementation of Signal Protocol.

export async function generateKeyPair() {
    const keyPair = await crypto.subtle.generateKey(
        {
            name: "ECDH",
            namedCurve: "P-256",
        },
        true, // extractable
        ["deriveKey", "deriveBits"]
    );

    // Export public key to send to server
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

    return {
        privateKey: keyPair.privateKey,
        publicKey: keyPair.publicKey,
        publicKeyJwk
    };
}

export async function importPublicKey(jwk) {
    if (!jwk) throw new Error("Cannot import public key: JWK is missing or null");
    const keyObj = typeof jwk === 'string' ? JSON.parse(jwk) : jwk;

    return await crypto.subtle.importKey(
        "jwk",
        keyObj,
        {
            name: "ECDH",
            namedCurve: "P-256",
        },
        true,
        []
    );
}

async function deriveSharedSecret(privateKey, publicKey) {
    return await crypto.subtle.deriveKey(
        {
            name: "ECDH",
            public: publicKey,
        },
        privateKey,
        {
            name: "AES-GCM",
            length: 256,
        },
        true,
        ["encrypt", "decrypt"]
    );
}

export async function encryptMessage(plaintext, senderPrivateKey, recipientPublicKeyJwk) {
    const recipientPublicKey = await importPublicKey(recipientPublicKeyJwk);
    const sharedSecret = await deriveSharedSecret(senderPrivateKey, recipientPublicKey);

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encodedPlaintext = new TextEncoder().encode(plaintext);

    const ciphertextBuffer = await crypto.subtle.encrypt(
        {
            name: "AES-GCM",
            iv: iv,
        },
        sharedSecret,
        encodedPlaintext
    );

    const ciphertext = Array.from(new Uint8Array(ciphertextBuffer))
        .map(b => b.toString(16).padStart(2, '0')).join('');

    const ivHex = Array.from(iv)
        .map(b => b.toString(16).padStart(2, '0')).join('');

    return { ciphertext, iv: ivHex };
}

export async function decryptMessage(ciphertextHex, ivHex, senderPublicKeyJwk, recipientPrivateKey) {
    const senderPublicKey = await importPublicKey(senderPublicKeyJwk);
    const sharedSecret = await deriveSharedSecret(recipientPrivateKey, senderPublicKey);

    const ciphertextArray = new Uint8Array(ciphertextHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    const ivArray = new Uint8Array(ivHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

    const decryptedBuffer = await crypto.subtle.decrypt(
        {
            name: "AES-GCM",
            iv: ivArray,
        },
        sharedSecret,
        ciphertextArray
    );

    return new TextDecoder().decode(decryptedBuffer);
}