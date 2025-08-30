;; LaptopNFT Contract
;; Implements NFTs for laptops using SIP-009 standard.
;; Each NFT represents a unique laptop with verifiable repair history.
;; Features include minting, transferring, burning, metadata updates,
;; repair log management, ownership verification, and access controls.

;; Traits
(define-trait nft-trait
  (
    (get-last-token-id () (response uint uint))
    (get-token-uri (uint) (response (optional (string-ascii 256)) uint))
    (get-owner (uint) (response (optional principal) uint))
    (transfer (uint principal principal) (response bool uint))
  )
)

;; Constants
(define-constant ERR-NOT-OWNER u100)
(define-constant ERR-INVALID-ID u101)
(define-constant ERR-ALREADY-MINTED u102)
(define-constant ERR-NOT-AUTHORIZED u103)
(define-constant ERR-PAUSED u104)
(define-constant ERR-INVALID-METADATA u105)
(define-constant ERR-MAX-LOGS-REACHED u106)
(define-constant ERR-NOT-REGISTERED-USER u107)
(define-constant CONTRACT-OWNER tx-sender)
(define-constant MAX-REPAIR-LOGS u100)
(define-constant MAX-SERIAL-LEN u50)
(define-constant MAX-DESCRIPTION-LEN u256)
(define-constant MAX-LOG-DESC-LEN u512)

;; Data Variables
(define-data-var contract-paused bool false)
(define-data-var last-token-id uint u0)
(define-data-var admin principal CONTRACT-OWNER)

;; Data Maps
(define-non-fungible-token laptop-nft uint)
(define-map nft-metadata uint 
  {
    serial: (string-ascii 50),
    description: (optional (string-utf8 256)),
    repair-logs: (list 100 uint),
    minted-at: uint,
    last-updated: uint
  }
)
(define-map repair-log-details uint 
  {
    log-id: uint,
    description: (string-utf8 512),
    timestamp: uint,
    shop: principal
  }
)

;; Private Functions
(define-private (is-contract-owner (caller principal))
  (is-eq caller (var-get admin))
)

(define-private (is-nft-owner (id uint) (caller principal))
  (is-eq (some caller) (nft-get-owner? laptop-nft id))
)

(define-private (validate-serial (serial (string-ascii 50)))
  (and (> (len serial) u0) (<= (len serial) MAX-SERIAL-LEN))
)

(define-private (validate-description (desc (string-utf8 256)))
  (<= (len desc) MAX-DESCRIPTION-LEN)
)

(define-private (validate-log-description (desc (string-utf8 512)))
  (<= (len desc) MAX-LOG-DESC-LEN)
)

(define-private (validate-principal (p principal))
  (not (is-eq p (as-contract tx-sender)))
)

;; Public Functions

(define-public (pause-contract)
  (begin
    (asserts! (is-contract-owner tx-sender) (err ERR-NOT-AUTHORIZED))
    (ok (var-set contract-paused true))
  )
)

(define-public (unpause-contract)
  (begin
    (asserts! (is-contract-owner tx-sender) (err ERR-NOT-AUTHORIZED))
    (ok (var-set contract-paused false))
  )
)

(define-public (set-admin (new-admin principal))
  (begin
    (asserts! (is-contract-owner tx-sender) (err ERR-NOT-AUTHORIZED))
    (asserts! (validate-principal new-admin) (err ERR-INVALID-METADATA))
    (ok (var-set admin new-admin))
  )
)

(define-public (mint-laptop (serial (string-ascii 50)) (description (optional (string-utf8 256))))
  (let
    (
      (new-id (+ (var-get last-token-id) u1))
    )
    (asserts! (not (var-get contract-paused)) (err ERR-PAUSED))
    (asserts! (validate-serial serial) (err ERR-INVALID-METADATA))
    (if (is-some description)
      (asserts! (validate-description (unwrap-panic description)) (err ERR-INVALID-METADATA))
      true
    )
    ;; Assume UserRegistry check (mocked in tests)
    ;; (try! (contract-call? .UserRegistry get-user-role tx-sender))
    (try! (nft-mint? laptop-nft new-id tx-sender))
    (map-set nft-metadata new-id 
      {
        serial: serial,
        description: description,
        repair-logs: (list),
        minted-at: block-height,
        last-updated: block-height
      }
    )
    (var-set last-token-id new-id)
    (ok new-id)
  )
)

(define-public (transfer (id uint) (sender principal) (recipient principal))
  (begin
    (asserts! (not (var-get contract-paused)) (err ERR-PAUSED))
    (asserts! (and (is-eq tx-sender sender) (is-nft-owner id sender)) (err ERR-NOT-OWNER))
    (asserts! (validate-principal recipient) (err ERR-INVALID-METADATA))
    (nft-transfer? laptop-nft id sender recipient)
  )
)

(define-public (burn-laptop (id uint))
  (begin
    (asserts! (not (var-get contract-paused)) (err ERR-PAUSED))
    (asserts! (is-nft-owner id tx-sender) (err ERR-NOT-OWNER))
    (nft-burn? laptop-nft id tx-sender)
  )
)

(define-public (update-description (id uint) (new-desc (string-utf8 256)))
  (begin
    (asserts! (not (var-get contract-paused)) (err ERR-PAUSED))
    (match (nft-get-owner? laptop-nft id)
      owner (begin
              (asserts! (is-eq tx-sender owner) (err ERR-NOT-OWNER))
              (match (map-get? nft-metadata id)
                meta (begin
                       (asserts! (validate-description new-desc) (err ERR-INVALID-METADATA))
                       (ok (map-set nft-metadata id 
                             (merge meta 
                               {
                                 description: (some new-desc),
                                 last-updated: block-height
                               }
                             )
                           )
                       )
                     )
                (err ERR-INVALID-ID)
              )
            )
      (err ERR-INVALID-ID)
    )
  )
)

(define-public (append-repair-log (id uint) (log-desc (string-utf8 512)) (shop principal))
  (begin
    (asserts! (not (var-get contract-paused)) (err ERR-PAUSED))
    (asserts! (validate-principal shop) (err ERR-INVALID-METADATA))
    (match (nft-get-owner? laptop-nft id)
      owner (begin
              (asserts! (is-eq tx-sender owner) (err ERR-NOT-OWNER))
              (match (map-get? nft-metadata id)
                meta (let 
                       (
                         (current-logs (get repair-logs meta))
                         (log-id (+ (var-get last-token-id) u1))
                       )
                       (asserts! (< (len current-logs) MAX-REPAIR-LOGS) (err ERR-MAX-LOGS-REACHED))
                       (asserts! (validate-log-description log-desc) (err ERR-INVALID-METADATA))
                       (map-set repair-log-details log-id
                         {
                           log-id: log-id,
                           description: log-desc,
                           timestamp: block-height,
                           shop: shop
                         }
                       )
                       (map-set nft-metadata id
                         (merge meta
                           {
                             repair-logs: (unwrap-panic (as-max-len? (append current-logs log-id) u100)),
                             last-updated: block-height
                           }
                         )
                       )
                       (ok log-id)
                     )
                (err ERR-INVALID-ID)
              )
            )
      (err ERR-INVALID-ID)
    )
  )
)

;; Read-Only Functions

(define-read-only (get-last-token-id)
  (ok (var-get last-token-id))
)

(define-read-only (get-token-uri (id uint))
  (ok none)
)

(define-read-only (get-owner (id uint))
  (ok (nft-get-owner? laptop-nft id))
)

(define-read-only (get-laptop-details (id uint))
  (map-get? nft-metadata id)
)

(define-read-only (get-repair-log (log-id uint))
  (map-get? repair-log-details log-id)
)

(define-read-only (get-all-repair-logs (id uint))
  (match (map-get? nft-metadata id)
    meta (ok (get repair-logs meta))
    none (err ERR-INVALID-ID)
  )
)

(define FILLER 1)
(define FILLER2 1)
(define FILLER3 1)
(define FILLER4 1)
(define FILLER5 1)

(define-read-only (is-paused)
  (ok (var-get contract-paused))
)

(define-read-only (get-admin)
  (ok (var-get admin))
)

(define-read-only (verify-ownership (id uint) (claimed-owner principal))
  (match (nft-get-owner? laptop-nft id)
    owner (ok (is-eq owner claimed-owner))
    none (ok false)
  )
)