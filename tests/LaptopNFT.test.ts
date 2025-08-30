import { describe, expect, it, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface LaptopMetadata {
  serial: string;
  description: string | null;
  repairLogs: number[];
  mintedAt: number;
  lastUpdated: number;
}

interface RepairLog {
  logId: number;
  description: string;
  timestamp: number;
  shop: string;
}

interface ContractState {
  paused: boolean;
  lastTokenId: number;
  lastLogId: number;
  admin: string;
  nfts: Map<number, string>;
  metadata: Map<number, LaptopMetadata>;
  repairLogs: Map<number, RepairLog>;
}

type principal = string;

// Mock contract implementation
class LaptopNFTMock {
  private state: ContractState = {
    paused: false,
    lastTokenId: 0,
    lastLogId: 0,
    admin: "deployer",
    nfts: new Map(),
    metadata: new Map(),
    repairLogs: new Map(),
  };

  private ERR_NOT_OWNER = 100;
  private ERR_INVALID_ID = 101;
  private ERR_NOT_AUTHORIZED = 103;
  private ERR_PAUSED = 104;
  private ERR_INVALID_METADATA = 105;
  private ERR_MAX_LOGS_REACHED = 106;
  private MAX_REPAIR_LOGS = 100;
  private MAX_SERIAL_LEN = 50;
  private MAX_DESCRIPTION_LEN = 256;
  private MAX_LOG_DESC_LEN = 512;

  private isContractOwner(caller: principal): boolean {
    return caller === this.state.admin;
  }

  private isNftOwner(id: number, caller: principal): boolean {
    return this.state.nfts.get(id) === caller;
  }

  private validateSerial(serial: string): boolean {
    return serial.length > 0 && serial.length <= this.MAX_SERIAL_LEN;
  }

  private validateDescription(desc: string): boolean {
    return desc.length <= this.MAX_DESCRIPTION_LEN;
  }

  private validateLogDescription(desc: string): boolean {
    return desc.length <= this.MAX_LOG_DESC_LEN;
  }

  private validatePrincipal(p: principal): boolean {
    return p !== "contract";
  }

  pauseContract(caller: principal): ClarityResponse<boolean> {
    if (!this.isContractOwner(caller)) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    this.state.paused = true;
    return { ok: true, value: true };
  }

  unpauseContract(caller: principal): ClarityResponse<boolean> {
    if (!this.isContractOwner(caller)) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    this.state.paused = false;
    return { ok: true, value: true };
  }

  setFactAdmin(caller: principal, newAdmin: principal): ClarityResponse<boolean> {
    if (!this.isContractOwner(caller)) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    if (!this.validatePrincipal(newAdmin)) {
      return { ok: false, value: this.ERR_INVALID_METADATA };
    }
    this.state.admin = newAdmin;
    return { ok: true, value: true };
  }

  mintLaptop(caller: principal, serial: string, description: string | null): ClarityResponse<number> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (!this.validateSerial(serial)) {
      return { ok: false, value: this.ERR_INVALID_METADATA };
    }
    if (description && !this.validateDescription(description)) {
      return { ok: false, value: this.ERR_INVALID_METADATA };
    }
    const newId = this.state.lastTokenId + 1;
    this.state.nfts.set(newId, caller);
    this.state.metadata.set(newId, {
      serial,
      description,
      repairLogs: [],
      mintedAt: Date.now(),
      lastUpdated: Date.now(),
    });
    this.state.lastTokenId = newId;
    return { ok: true, value: newId };
  }

  transfer(caller: principal, id: number, sender: principal, recipient: principal): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (caller !== sender || !this.isNftOwner(id, sender)) {
      return { ok: false, value: this.ERR_NOT_OWNER };
    }
    if (!this.validatePrincipal(recipient)) {
      return { ok: false, value: this.ERR_INVALID_METADATA };
    }
    this.state.nfts.set(id, recipient);
    return { ok: true, value: true };
  }

  burnLaptop(caller: principal, id: number): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (!this.isNftOwner(id, caller)) {
      return { ok: false, value: this.ERR_NOT_OWNER };
    }
    this.state.nfts.delete(id);
    this.state.metadata.delete(id);
    return { ok: true, value: true };
  }

  updateDescription(caller: principal, id: number, newDesc: string): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    const owner = this.state.nfts.get(id);
    if (!owner || owner !== caller) {
      return { ok: false, value: this.ERR_NOT_OWNER };
    }
    const meta = this.state.metadata.get(id);
    if (!meta || !this.validateDescription(newDesc)) {
      return { ok: false, value: this.ERR_INVALID_METADATA };
    }
    meta.description = newDesc;
    meta.lastUpdated = Date.now();
    this.state.metadata.set(id, meta);
    return { ok: true, value: true };
  }

  appendRepairLog(caller: principal, id: number, logDesc: string, shop: principal): ClarityResponse<number> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (!this.validatePrincipal(shop)) {
      return { ok: false, value: this.ERR_INVALID_METADATA };
    }
    const owner = this.state.nfts.get(id);
    if (!owner || owner !== caller) {
      return { ok: false, value: this.ERR_NOT_OWNER };
    }
    const meta = this.state.metadata.get(id);
    if (!meta) {
      return { ok: false, value: this.ERR_INVALID_ID };
    }
    if (meta.repairLogs.length >= this.MAX_REPAIR_LOGS) {
      return { ok: false, value: this.ERR_MAX_LOGS_REACHED };
    }
    if (!this.validateLogDescription(logDesc)) {
      return { ok: false, value: this.ERR_INVALID_METADATA };
    }
    const logId = this.state.lastLogId + 1;
    this.state.repairLogs.set(logId, {
      logId,
      description: logDesc,
      timestamp: Date.now(),
      shop,
    });
    meta.repairLogs.push(logId);
    meta.lastUpdated = Date.now();
    this.state.metadata.set(id, meta);
    this.state.lastLogId = logId;
    return { ok: true, value: logId };
  }

  getLastTokenId(): ClarityResponse<number> {
    return { ok: true, value: this.state.lastTokenId };
  }

  getTokenUri(id: number): ClarityResponse<string | null> {
    return { ok: true, value: null };
  }

  getOwner(id: number): ClarityResponse<principal | null> {
    return { ok: true, value: this.state.nfts.get(id) ?? null };
  }

  getLaptopDetails(id: number): ClarityResponse<LaptopMetadata | null> {
    return { ok: true, value: this.state.metadata.get(id) ?? null };
  }

  getRepairLog(logId: number): ClarityResponse<RepairLog | null> {
    return { ok: true, value: this.state.repairLogs.get(logId) ?? null };
  }

  getAllRepairLogs(id: number): ClarityResponse<number[] | number> {
    const meta = this.state.metadata.get(id);
    if (!meta) {
      return { ok: false, value: this.ERR_INVALID_ID };
    }
    return { ok: true, value: meta.repairLogs };
  }

  isPaused(): ClarityResponse<boolean> {
    return { ok: true, value: this.state.paused };
  }
}

// Test Suite
describe("LaptopNFT Contract", () => {
  let contract: LaptopNFTMock;
  const deployer = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
  const user1 = "ST2CY5AA2B3S6KC2GY5A2VST3G5B3S6KC2GY5A2VST";
  const user2 = "ST3N4AJ39Q1F7A4HY3J5N4AJ39Q1F7A4HY3J5N4AJ";
  const shop = "ST4RE8N4AJ39Q1F7A4HY3J5N4AJ39Q1F7A4HY3J5N";
  const invalidPrincipal = "contract";

  beforeEach(() => {
    contract = new LaptopNFTMock();
  });

  describe("Contract Admin Functions", () => {
    it("should prevent non-deployer from pausing contract", () => {
      const result = contract.pauseContract(user1);
      expect(result).toEqual({ ok: false, value: 103 });
      expect(contract.isPaused()).toEqual({ ok: true, value: false });
    });

    it("should prevent non-deployer from setting admin", () => {
      const result = contract.setFactAdmin(user1, user2);
      expect(result).toEqual({ ok: false, value: 103 });
      expect(contract.pauseContract(user1)).toEqual({ ok: false, value: 103 });
    });
  });

  describe("Minting and Ownership", () => {
    it("should mint a new laptop NFT", () => {
      const result = contract.mintLaptop(user1, "SERIAL123", "Test Laptop");
      expect(result).toEqual({ ok: true, value: 1 });
      expect(contract.getOwner(1)).toEqual({ ok: true, value: user1 });
      const details = contract.getLaptopDetails(1).value as LaptopMetadata;
      expect(details.serial).toBe("SERIAL123");
      expect(details.description).toBe("Test Laptop");
      expect(details.repairLogs).toEqual([]);
      expect(contract.getLastTokenId()).toEqual({ ok: true, value: 1 });
    });

    it("should fail to mint with invalid serial", () => {
      const longSerial = "A".repeat(51);
      const result = contract.mintLaptop(user1, longSerial, "Test Laptop");
      expect(result).toEqual({ ok: false, value: 105 });
    });

    it("should fail to mint with invalid description", () => {
      const longDesc = "A".repeat(257);
      const result = contract.mintLaptop(user1, "SERIAL123", longDesc);
      expect(result).toEqual({ ok: false, value: 105 });
    });
  });

  describe("Transfer and Burning", () => {
    beforeEach(() => {
      contract.mintLaptop(user1, "SERIAL123", "Test Laptop");
    });

    it("should transfer NFT to another user", () => {
      const result = contract.transfer(user1, 1, user1, user2);
      expect(result).toEqual({ ok: true, value: true });
      expect(contract.getOwner(1)).toEqual({ ok: true, value: user2 });
    });

    it("should fail to transfer if caller is not owner", () => {
      const result = contract.transfer(user2, 1, user1, user2);
      expect(result).toEqual({ ok: false, value: 100 });
    });

    it("should fail to transfer to invalid principal", () => {
      const result = contract.transfer(user1, 1, user1, invalidPrincipal);
      expect(result).toEqual({ ok: false, value: 105 });
    });

    it("should burn NFT", () => {
      const result = contract.burnLaptop(user1, 1);
      expect(result).toEqual({ ok: true, value: true });
      expect(contract.getOwner(1)).toEqual({ ok: true, value: null });
      expect(contract.getLaptopDetails(1)).toEqual({ ok: true, value: null });
    });

    it("should fail to burn if caller is not owner", () => {
      const result = contract.burnLaptop(user2, 1);
      expect(result).toEqual({ ok: false, value: 100 });
    });
  });

  describe("Description Updates", () => {
    beforeEach(() => {
      contract.mintLaptop(user1, "SERIAL123", "Test Laptop");
    });

    it("should update description", () => {
      const result = contract.updateDescription(user1, 1, "Updated Laptop");
      expect(result).toEqual({ ok: true, value: true });
      const details = contract.getLaptopDetails(1).value as LaptopMetadata;
      expect(details.description).toBe("Updated Laptop");
    });

    it("should fail to update description if not owner", () => {
      const result = contract.updateDescription(user2, 1, "Updated Laptop");
      expect(result).toEqual({ ok: false, value: 100 });
    });

    it("should fail to update with invalid description", () => {
      const longDesc = "A".repeat(257);
      const result = contract.updateDescription(user1, 1, longDesc);
      expect(result).toEqual({ ok: false, value: 105 });
    });
  });

  describe("Repair Logs", () => {
    beforeEach(() => {
      contract.mintLaptop(user1, "SERIAL123", "Test Laptop");
    });

    it("should append repair log", () => {
      const result = contract.appendRepairLog(user1, 1, "Screen repaired", shop);
      expect(result).toEqual({ ok: true, value: 1 });
      const logs = contract.getAllRepairLogs(1).value as number[];
      expect(logs).toEqual([1]);
      const log = contract.getRepairLog(1).value as RepairLog;
      expect(log.description).toBe("Screen repaired");
      expect(log.shop).toBe(shop);
    });

    it("should fail to append repair log if not owner", () => {
      const result = contract.appendRepairLog(user2, 1, "Screen repaired", shop);
      expect(result).toEqual({ ok: false, value: 100 });
    });

    it("should fail to append repair log with invalid shop principal", () => {
      const result = contract.appendRepairLog(user1, 1, "Screen repaired", invalidPrincipal);
      expect(result).toEqual({ ok: false, value: 105 });
    });

    it("should fail to append repair log with invalid description", () => {
      const longDesc = "A".repeat(513);
      const result = contract.appendRepairLog(user1, 1, longDesc, shop);
      expect(result).toEqual({ ok: false, value: 105 });
    });

    it("should fail to append repair log when max logs reached", () => {
      const meta = contract.getLaptopDetails(1).value as LaptopMetadata;
      meta.repairLogs = Array(100).fill(1);
      contract.getLaptopDetails(1).value = meta;
      const result = contract.appendRepairLog(user1, 1, "Screen repaired", shop);
      expect(result).toEqual({ ok: false, value: 106 });
    });
  });

  describe("Read-Only Functions", () => {
    it("should return last token ID", () => {
      expect(contract.getLastTokenId()).toEqual({ ok: true, value: 0 });
      contract.mintLaptop(user1, "SERIAL123", "Test Laptop");
      expect(contract.getLastTokenId()).toEqual({ ok: true, value: 1 });
    });

    it("should return token URI as null", () => {
      expect(contract.getTokenUri(1)).toEqual({ ok: true, value: null });
    });

    it("should return correct owner", () => {
      contract.mintLaptop(user1, "SERIAL123", "Test Laptop");
      expect(contract.getOwner(1)).toEqual({ ok: true, value: user1 });
      expect(contract.getOwner(999)).toEqual({ ok: true, value: null });
    });

    it("should return laptop details", () => {
      contract.mintLaptop(user1, "SERIAL123", "Test Laptop");
      const details = contract.getLaptopDetails(1).value as LaptopMetadata;
      expect(details.serial).toBe("SERIAL123");
      expect(details.description).toBe("Test Laptop");
      expect(contract.getLaptopDetails(999)).toEqual({ ok: true, value: null });
    });

    it("should return repair log", () => {
      contract.mintLaptop(user1, "SERIAL123", "Test Laptop");
      contract.appendRepairLog(user1, 1, "Screen repaired", shop);
      const log = contract.getRepairLog(1).value as RepairLog;
      expect(log.description).toBe("Screen repaired");
      expect(log.shop).toBe(shop);
      expect(contract.getRepairLog(999)).toEqual({ ok: true, value: null });
    });

    it("should return all repair logs", () => {
      contract.mintLaptop(user1, "SERIAL123", "Test Laptop");
      contract.appendRepairLog(user1, 1, "Screen repaired", shop);
      expect(contract.getAllRepairLogs(1)).toEqual({ ok: true, value: [1] });
      expect(contract.getAllRepairLogs(999)).toEqual({ ok: false, value: 101 });
    });
  });
});