import { PropertyStatusService } from './property-status.service';
import { BadRequestException } from '@nestjs/common';

describe('PropertyStatusService', () => {
  let service: PropertyStatusService;

  beforeEach(() => {
    service = new PropertyStatusService();
  });

  describe('canPublish', () => {
    it('should allow publishing from Draft', () => {
      expect(service.canPublish('Draft')).toBe(true);
    });

    it('should allow publishing from Expired', () => {
      expect(service.canPublish('Expired')).toBe(true);
    });

    it('should throw if publishing from Published', () => {
      expect(() => service.canPublish('Active')).toThrow(BadRequestException);
    });
  });

  describe('canMarkSold', () => {
    it('should allow marking sold from Published', () => {
      expect(service.canMarkSold('Active')).toBe(true);
    });

    it('should throw if marking sold from Draft', () => {
      expect(() => service.canMarkSold('Draft')).toThrow(BadRequestException);
    });
  });

  describe('canRelist', () => {
    it('should allow relisting from Sold', () => {
      expect(service.canRelist('Sold')).toBe(true);
    });

    it('should allow relisting from Expired', () => {
      expect(service.canRelist('Expired')).toBe(true);
    });

    it('should throw if relisting from Published', () => {
      expect(() => service.canRelist('Active')).toThrow(BadRequestException);
    });
  });
});
