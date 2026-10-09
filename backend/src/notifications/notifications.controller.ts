import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { NotificationsService } from "./notifications.service";
import { QueryNotificationsDto } from "./dto/query-notifications.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { TenantGuard } from "../tenancy/tenant.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { CurrentOrganization } from "../tenancy/decorators/current-organization.decorator";

@Controller("notifications")
@UseGuards(JwtAuthGuard, TenantGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * Paginated list of notifications belonging to current user in active tenant organization
   */
  @Get()
  async findAll(
    @CurrentUser("id") userId: string,
    @CurrentOrganization("id") organizationId: string,
    @Query() query: QueryNotificationsDto,
  ) {
    return this.notificationsService.findAllForUser(
      userId,
      organizationId,
      query,
    );
  }

  /**
   * Get unread notification count for current user in active tenant organization
   */
  @Get("unread-count")
  async getUnreadCount(
    @CurrentUser("id") userId: string,
    @CurrentOrganization("id") organizationId: string,
  ) {
    return this.notificationsService.getUnreadCount(userId, organizationId);
  }

  /**
   * Retrieve a single notification by ID
   */
  @Get(":notificationId")
  async findOne(
    @CurrentUser("id") userId: string,
    @CurrentOrganization("id") organizationId: string,
    @Param("notificationId") notificationId: string,
  ) {
    return this.notificationsService.findOne(
      userId,
      organizationId,
      notificationId,
    );
  }

  /**
   * Mark a single notification as read
   */
  @Patch(":notificationId/read")
  async markAsRead(
    @CurrentUser("id") userId: string,
    @CurrentOrganization("id") organizationId: string,
    @Param("notificationId") notificationId: string,
  ) {
    return this.notificationsService.markAsRead(
      userId,
      organizationId,
      notificationId,
    );
  }

  /**
   * Mark all unread notifications as read for current user in active tenant organization
   */
  @Patch("read-all")
  @HttpCode(HttpStatus.OK)
  async markAllAsRead(
    @CurrentUser("id") userId: string,
    @CurrentOrganization("id") organizationId: string,
  ) {
    return this.notificationsService.markAllAsRead(userId, organizationId);
  }
}
