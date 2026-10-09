import { Test, TestingModule } from "@nestjs/testing";
import { RedisService } from "./redis.service";

describe("RedisService", () => {
  let service: RedisService;
  let mockRedisClient: any;

  beforeEach(async () => {
    mockRedisClient = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      exists: jest.fn(),
      keys: jest.fn(),
      ping: jest.fn(),
      on: jest.fn(),
      quit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [RedisService],
    }).compile();

    service = module.get<RedisService>(RedisService);

    // Override internal redis client with mock
    (service as any).client = mockRedisClient;
    (service as any).isHealthy = true;
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("get", () => {
    it("should retrieve and parse JSON data on cache hit", async () => {
      const mockData = { id: "123", name: "Test Org" };
      mockRedisClient.get.mockResolvedValue(JSON.stringify(mockData));

      const result = await service.get("test-key");

      expect(result).toEqual(mockData);
      expect(mockRedisClient.get).toHaveBeenCalledWith("test-key");
    });

    it("should return null on cache miss", async () => {
      mockRedisClient.get.mockResolvedValue(null);

      const result = await service.get("test-key");

      expect(result).toBeNull();
    });

    it("should return null gracefully when redis client throws an error", async () => {
      mockRedisClient.get.mockRejectedValue(new Error("Connection lost"));

      const result = await service.get("test-key");

      expect(result).toBeNull();
    });

    it("should return null when service is not healthy", async () => {
      (service as any).isHealthy = false;

      const result = await service.get("test-key");

      expect(result).toBeNull();
      expect(mockRedisClient.get).not.toHaveBeenCalled();
    });
  });

  describe("set", () => {
    it("should store JSON string with TTL in seconds", async () => {
      mockRedisClient.set.mockResolvedValue("OK");

      const result = await service.set("test-key", { foo: "bar" }, 60);

      expect(result).toBe(true);
      expect(mockRedisClient.set).toHaveBeenCalledWith(
        "test-key",
        JSON.stringify({ foo: "bar" }),
        "EX",
        60,
      );
    });

    it("should return false gracefully when redis throws error", async () => {
      mockRedisClient.set.mockRejectedValue(new Error("Write error"));

      const result = await service.set("test-key", { foo: "bar" }, 60);

      expect(result).toBe(false);
    });
  });

  describe("del", () => {
    it("should delete a single key", async () => {
      mockRedisClient.del.mockResolvedValue(1);

      const result = await service.del("test-key");

      expect(result).toBe(true);
      expect(mockRedisClient.del).toHaveBeenCalledWith("test-key");
    });
  });

  describe("delMany", () => {
    it("should delete multiple keys when provided", async () => {
      mockRedisClient.del.mockResolvedValue(2);

      const result = await service.delMany(["key1", "key2"]);

      expect(result).toBe(true);
      expect(mockRedisClient.del).toHaveBeenCalledWith("key1", "key2");
    });

    it("should do nothing if empty array passed", async () => {
      const result = await service.delMany([]);

      expect(result).toBe(true);
      expect(mockRedisClient.del).not.toHaveBeenCalled();
    });
  });

  describe("invalidateByPrefix", () => {
    it("should find matching keys and delete them", async () => {
      mockRedisClient.keys.mockResolvedValue([
        "v1:tenant:org1:p1",
        "v1:tenant:org1:p2",
      ]);
      mockRedisClient.del.mockResolvedValue(2);

      const count = await service.invalidateByPrefix("v1:tenant:org1");

      expect(mockRedisClient.keys).toHaveBeenCalledWith("v1:tenant:org1*");
      expect(mockRedisClient.del).toHaveBeenCalledWith(
        "v1:tenant:org1:p1",
        "v1:tenant:org1:p2",
      );
      expect(count).toBe(2);
    });

    it("should return 0 if no keys match prefix", async () => {
      mockRedisClient.keys.mockResolvedValue([]);

      const count = await service.invalidateByPrefix("v1:tenant:org1");

      expect(count).toBe(0);
      expect(mockRedisClient.del).not.toHaveBeenCalled();
    });
  });
});
