# Mini WhatsApp Distributed Messaging Architecture

A miniature distributed messaging system demonstrating the core architecture, lifecycle, and failure modes of WhatsApp-like messaging.

## Architecture

```mermaid
flowchart LR
    A[Browser Client] -->|WebSocket| B[Messaging Server]
    B --> C[SQLite]
    B --> D[Presence Memory]
    A -->|HTTP Media Upload| B
    B --> E[Encrypted Media Storage]
```

## Message flow

```mermaid
sequenceDiagram
    participant B as Budi
    participant S as Server
    participant T as Siti

    B->>S: Encrypted SEND_MESSAGE
    S->>S: Persist
    S-->>B: MESSAGE_ACK (Sent)
    S->>T: DELIVER_MESSAGE
    T-->>S: DELIVERY_ACK
    S-->>B: DELIVERED (✓✓)
    T->>S: READ
    S-->>B: READ (✓✓ blue)
```

## Failure flow

### Sender offline

```text
Pending -> Local Outbox -> Reconnect -> Retry
```

### Server unavailable

```text
Disconnected -> Reconnect -> Retry
```

### Recipient offline

```text
Server Queue -> Recipient reconnect -> Delivery
```

### Server restart

```text
SQLite persists -> Server restarts -> Messages restored
```

## Media flow

```text
Client -> Encrypted media -> HTTP upload -> Local media storage
```

## Encryption

*Note: The crypto layer uses Web Crypto API for an educational E2EE demonstration. It is NOT a production implementation of the Signal Protocol.*
