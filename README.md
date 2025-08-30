## LaptopRepairChain

## Overview

LaptopRepairChain is a Web3 project built on the Stacks blockchain using Clarity smart contracts. It provides a decentralized platform for managing laptop repairs with blockchain-verified logs, virtual submission portals, and smart contract-facilitated in-person pickups. Users can submit repair requests online, track immutable repair histories, and securely handle payments and pickups, reducing trust issues in the repair industry.

This solves real-world problems such as:
- **Lack of transparency in repair logs**: Traditional repair shops can alter records, leading to disputes. Blockchain ensures immutable, verifiable histories.
- **Disputes over repair quality or completion**: Customers and shops can reference on-chain logs to resolve conflicts.
- **Fraud in resale markets**: Repair histories tied to laptop NFTs provide proof for second-hand buyers.
- **Inefficient submission and pickup processes**: Virtual portals streamline requests, while smart contracts automate escrow and verification for pickups.
- **Payment security**: Crypto escrows prevent non-delivery or non-payment issues.
- **Data tampering**: All actions are logged on-chain, aiding insurance claims or warranties.

The project involves 7 core smart contracts written in Clarity, deployable on Stacks. It assumes integration with a frontend dApp for user interactions (e.g., via Hiro Wallet for Stacks).

## Architecture

- **Blockchain**: Stacks (Bitcoin-secured).
- **Language**: Clarity (secure, decidable smart contract language).
- **Tokens**: Uses STX (Stacks token) for payments; NFTs for laptops.
- **Workflow**:
  1. User registers and mints an NFT for their laptop.
  2. Submits a repair request virtually.
  3. Repair shop accepts and logs repairs on-chain.
  4. Payment is escrowed.
  5. Upon completion, in-person pickup is verified via smart contract.
  6. Disputes can be raised and resolved on-chain.
  7. Repair logs are appended to the laptop NFT metadata.

## Smart Contracts

Below are the 7 smart contracts with descriptions, functionality, and full Clarity code. Each is in a separate `.clar` file. Contracts interact via cross-contract calls for modularity.

### 1. UserRegistry.clar
**Description**: Manages user registration for customers and repair shops. Stores roles and profiles. Ensures only registered users can interact with other contracts.

```
;; User Registry Contract
(define-constant ERR-ALREADY-REGISTERED (err u100))
(define-constant ERR-NOT-REGISTERED (err u101))

(define-map users principal {role: (string-ascii 20), profile: (string-utf8 256)})

(define-public (register-user (role (string-ascii 20)) (profile (string-utf8 256)))
  (if (is-some (map-get? users tx-sender))
    ERR-ALREADY-REGISTERED
    (ok (map-set users tx-sender {role: role, profile: profile}))
  )
)

(define-read-only (get-user-role (user principal))
  (match (map-get? users user)
    some-user (ok (get role some-user))
    none ERR-NOT-REGISTERED
  )
)

(define-read-only (is-repair-shop (user principal))
  (match (get-user-role user)
    role (ok (is-eq role "repair_shop"))
    err err
  )
)
```

### 2. LaptopNFT.clar
**Description**: Represents laptops as non-fungible tokens (NFTs) using SIP-009 standard. Each NFT holds metadata including serial number and a list of repair log IDs for verifiable history.

```
;; Laptop NFT Contract (SIP-009 compliant)
(define-trait nft-trait
  (
    (transfer (uint principal principal) (response bool uint))
    (get-owner (uint) (response (optional principal) uint))
    (get-token-uri (uint) (response (optional (string-ascii 256)) uint))
  )
)

(define-non-fungible-token laptop-nft uint)
(define-map nft-metadata uint {serial: (string-ascii 50), repair-logs: (list 100 uint)})

(define-constant ERR-NOT-OWNER (err u200))
(define-constant ERR-INVALID-ID (err u201))
(define-data-var last-id uint u0)

(define-public (mint-laptop (serial (string-ascii 50)))
  (let ((new-id (+ (var-get last-id) u1)))
    (try! (nft-mint? laptop-nft new-id tx-sender))
    (map-set nft-metadata new-id {serial: serial, repair-logs: (list)})
    (var-set last-id new-id)
    (ok new-id)
  )
)

(define-public (transfer (id uint) (recipient principal))
  (if (is-eq tx-sender (unwrap! (nft-get-owner? laptop-nft id) ERR-INVALID-ID))
    (nft-transfer? laptop-nft id tx-sender recipient)
    ERR-NOT-OWNER
  )
)

(define-read-only (get-owner (id uint))
  (ok (nft-get-owner? laptop-nft id))
)

(define-read-only (get-token-uri (id uint))
  (ok none) ;; Placeholder for off-chain URI
)

(define-public (append-repair-log (id uint) (log-id uint))
  (if (is-eq tx-sender (unwrap! (nft-get-owner? laptop-nft id) ERR-INVALID-ID))
    (match (map-get? nft-metadata id)
      meta (let ((new-logs (append (get repair-logs meta) log-id)))
             (ok (map-set nft-metadata id {serial: (get serial meta), repair-logs: new-logs})))
      none ERR-INVALID-ID
    )
    ERR-NOT-OWNER
  )
)
```

### 3. RepairSubmission.clar
**Description**: Handles virtual submission of repair requests. Creates a repair ticket linked to a laptop NFT. Repair shops can accept requests.

```
;; Repair Submission Contract
(define-constant ERR-NOT-CUSTOMER (err u300))
(define-constant ERR-INVALID-LAPTOP (err u301))

(define-map repair-requests uint {laptop-id: uint, description: (string-utf8 512), status: (string-ascii 20), shop: (optional principal)})
(define-data-var request-counter uint u0)

(define-public (submit-request (laptop-id uint) (description (string-utf8 512)))
  (if (is-eq (unwrap-panic (contract-call? .UserRegistry get-user-role tx-sender)) "customer")
    (let ((new-id (+ (var-get request-counter) u1)))
      (map-set repair-requests new-id {laptop-id: laptop-id, description: description, status: "submitted", shop: none})
      (var-set request-counter new-id)
      (ok new-id)
    )
    ERR-NOT-CUSTOMER
  )
)

(define-public (accept-request (request-id uint))
  (match (map-get? repair-requests request-id)
    req (if (and (is-eq (get status req) "submitted") (unwrap-panic (contract-call? .UserRegistry is-repair-shop tx-sender)))
          (ok (map-set repair-requests request-id (merge req {status: "accepted", shop: (some tx-sender)})))
          (err u302) ;; Invalid status or not shop
        )
    none ERR-INVALID-LAPTOP
  )
)
```

### 4. RepairLog.clar
**Description**: Logs repair actions immutably. Each log entry is tied to a request and appended to the laptop NFT's history.

```
;; Repair Log Contract
(define-constant ERR-NOT-ACCEPTED-SHOP (err u400))

(define-map repair-logs uint {request-id: uint, actions: (list 50 (string-utf8 256)), timestamp: uint})
(define-data-var log-counter uint u0)

(define-public (log-action (request-id uint) (action (string-utf8 256)))
  (match (map-get? .RepairSubmission repair-requests request-id)
    req (if (is-eq (unwrap! (get shop req) (err u401)) tx-sender)
          (let ((new-id (+ (var-get log-counter) u1)))
            (map-set repair-logs new-id {request-id: request-id, actions: (list action), timestamp: block-height})
            (try! (contract-call? .LaptopNFT append-repair-log (get laptop-id req) new-id))
            (var-set log-counter new-id)
            (ok new-id)
          )
          ERR-NOT-ACCEPTED-SHOP
        )
    none (err u402)
  )
)

(define-public (append-action (log-id uint) (action (string-utf8 256)))
  (match (map-get? repair-logs log-id)
    log (if (is-eq tx-sender (unwrap! (get shop (unwrap-panic (map-get? .RepairSubmission repair-requests (get request-id log)))) (err u403)))
          (ok (map-set repair-logs log-id (merge log {actions: (append (get actions log) action)})))
          ERR-NOT-ACCEPTED-SHOP
        )
    none (err u404)
  )
)
```

### 5. PickupContract.clar
**Description**: Manages in-person pickup. Generates a verification code; customer confirms pickup on-chain to release escrow.

```
;; Pickup Contract
(define-constant ERR-NOT-READY (err u500))

(define-map pickups uint {request-id: uint, verification-code: (string-ascii 10), status: (string-ascii 20)})

(define-public (initiate-pickup (request-id uint) (code (string-ascii 10)))
  (match (map-get? .RepairSubmission repair-requests request-id)
    req (if (and (is-eq (get status req) "completed") (is-eq tx-sender (unwrap! (get shop req) (err u501))))
          (ok (map-set pickups request-id {request-id: request-id, verification-code: code, status: "ready"}))
          ERR-NOT-READY
        )
    none (err u502)
  )
)

(define-public (confirm-pickup (request-id uint) (code (string-ascii 10)))
  (match (map-get? pickups request-id)
    pickup (if (and (is-eq (get status pickup) "ready") (is-eq code (get verification-code pickup)))
             (begin
               (try! (contract-call? .RepairSubmission update-status request-id "picked_up"))
               (try! (contract-call? .PaymentEscrow release-funds request-id))
               (ok true)
             )
             (err u503) ;; Invalid code
           )
    none (err u504)
  )
)

;; Helper in RepairSubmission (assume added)
(define-public (update-status (request-id uint) (new-status (string-ascii 20)))
  ;; Implementation omitted for brevity
)
```

### 6. PaymentEscrow.clar
**Description**: Escrows STX payments for repairs. Holds funds until pickup confirmation or dispute resolution.

```
;; Payment Escrow Contract
(define-constant ERR-INSUFFICIENT-FUNDS (err u600))

(define-map escrows uint {request-id: uint, amount: uint, payer: principal, payee: principal})

(define-public (escrow-payment (request-id uint) (amount uint))
  (match (map-get? .RepairSubmission repair-requests request-id)
    req (if (is-eq (get status req) "accepted")
          (begin
            (try! (stx-transfer? amount tx-sender (as-contract tx-sender)))
            (ok (map-set escrows request-id {request-id: request-id, amount: amount, payer: tx-sender, payee: (unwrap! (get shop req) (err u601))}))
          )
          (err u602)
        )
    none (err u603)
  )
)

(define-public (release-funds (request-id uint))
  (match (map-get? escrows request-id)
    esc (let ((payee (get payee esc)))
          (as-contract (stx-transfer? (get amount esc) tx-sender payee))
        )
    none ERR-INSUFFICIENT-FUNDS
  )
)
```

### 7. DisputeResolution.clar
**Description**: Allows disputes on repairs. Uses a simple oracle or voting mechanism (e.g., registered shops vote) to resolve and refund/release funds.

```
;; Dispute Resolution Contract
(define-constant ERR-NO-DISPUTE (err u700))

(define-map disputes uint {request-id: uint, reason: (string-utf8 512), votes-for-customer: uint, votes-for-shop: uint, resolved: bool})
(define-map voters uint (list 100 principal))

(define-public (raise-dispute (request-id uint) (reason (string-utf8 512)))
  (match (map-get? .RepairSubmission repair-requests request-id)
    req (if (is-eq tx-sender (unwrap-panic (contract-call? .LaptopNFT get-owner (get laptop-id req))))
          (ok (map-set disputes request-id {request-id: request-id, reason: reason, votes-for-customer: u0, votes-for-shop: u0, resolved: false}))
          (err u701)
        )
    none (err u702)
  )
)

(define-public (vote-on-dispute (dispute-id uint) (vote-for-customer bool))
  (match (map-get? disputes dispute-id)
    disp (if (and (not (get resolved disp)) (unwrap-panic (contract-call? .UserRegistry is-repair-shop tx-sender)))
           (ok (map-set disputes dispute-id
                (if vote-for-customer
                  (merge disp {votes-for-customer: (+ (get votes-for-customer disp) u1)})
                  (merge disp {votes-for-shop: (+ (get votes-for-shop disp) u1)})
                )))
           (err u703)
         )
    none ERR-NO-DISPUTE
  )
)

(define-public (resolve-dispute (dispute-id uint))
  (match (map-get? disputes dispute-id)
    disp (if (not (get resolved disp))
           (let ((customer-wins (> (get votes-for-customer disp) (get votes-for-shop disp))))
             (map-set disputes dispute-id (merge disp {resolved: true}))
             (if customer-wins
               (contract-call? .PaymentEscrow refund-payer (get request-id disp))
               (contract-call? .PaymentEscrow release-funds (get request-id disp))
             )
           )
           (err u704)
         )
    none ERR-NO-DISPUTE
  )
)

;; Helper in PaymentEscrow (assume added)
(define-public (refund-payer (request-id uint))
  ;; Implementation omitted for brevity
)
```

## Deployment and Usage

1. Deploy contracts on Stacks testnet/mainnet using Clarity CLI.
2. Interact via Hiro Wallet or custom dApp.
3. For production, add error handling, fees, and oracles for advanced disputes.

## Dependencies

- Stacks blockchain.
- No external libraries; pure Clarity.

## License

MIT License.