import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  VERSION_NEUTRAL,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { MessageBus, serviceCallGuard } from '@tilomnov/shared';
import { CallNotifier } from '../calls/call-notifier';
import { ChatMessageNotifier } from '../chat/chat-message-notifier';
import { DeliveryReport } from '../delivery/push-delivery.service';
import { PushTarget } from '../delivery/push-sender';
import { ListingAlertNotifier } from '../listings/listing-alert-notifier';
import {
  followedListingPush,
  priceDropPush,
  soldPush,
} from '../listings/listing-update.push';
import { savedSearchMatchPush } from '../listings/saved-search-match.push';
import { SignInAlertNotifier } from '../security/sign-in-alert-notifier';
import { ExpiryReminderNotifier } from '../billing/expiry-reminder-notifier';
import { ExpiryReminderDto } from './dto/expiry-reminder.dto';
import {
  CallEndedEventDto,
  CallEventDto,
  ChatMessageEventDto,
  SignInEventDto,
} from './dto/notification-events.dto';
import {
  FollowedListingEventDto,
  SavedListingUpdateEventDto,
  SavedSearchMatchEventDto,
} from './dto/listing-events.dto';

/**
 * What other services ask to be notified. Never reached by the app: the
 * gateway does not forward `/internal`, and each route accepts only the
 * service that owns the event.
 */
@ApiExcludeController()
@Controller({ path: 'internal/notifications', version: VERSION_NEUTRAL })
export class InternalNotificationsController implements OnModuleInit {
  constructor(
    private readonly chatMessages: ChatMessageNotifier,
    private readonly signIns: SignInAlertNotifier,
    private readonly calls: CallNotifier,
    private readonly listingAlerts: ListingAlertNotifier,
    private readonly expiryReminders: ExpiryReminderNotifier,
    @Optional() private readonly messages?: MessageBus,
  ) {}

  onModuleInit(): void {
    if (!this.messages) return;
    const requireDelivered = async (report: Promise<DeliveryReport>) => {
      const result = await report;
      if (result.failed > result.removed)
        throw new Error('Push delivery incomplete');
    };
    this.messages.handleValidated(
      'notification.chat-message.v1',
      ChatMessageEventDto,
      (event) => requireDelivered(this.chatMessage(event)),
    );
    this.messages.handleValidated(
      'notification.sign-in.v1',
      SignInEventDto,
      (event) => requireDelivered(this.signIn(event)),
    );
    this.messages.handleValidated(
      'notification.saved-search-match.v1',
      SavedSearchMatchEventDto,
      (event) => requireDelivered(this.savedSearchMatch(event)),
    );
    this.messages.handleValidated(
      'notification.followed-listing.v1',
      FollowedListingEventDto,
      (event) => requireDelivered(this.followedListing(event)),
    );
    this.messages.handleValidated(
      'notification.saved-listing-update.v1',
      SavedListingUpdateEventDto,
      (event) => requireDelivered(this.savedListingUpdate(event)),
    );
    this.messages.handleValidated(
      'notification.publishing-expiry.v1',
      ExpiryReminderDto,
      async (event) => {
        if (new Date(event.expiresAt).getTime() > Date.now())
          await requireDelivered(this.publishingExpiry(event));
      },
    );
  }

  @UseGuards(serviceCallGuard('payment'))
  @Post('publishing-expiry')
  @HttpCode(HttpStatus.OK)
  publishingExpiry(@Body() event: ExpiryReminderDto): Promise<DeliveryReport> {
    return this.expiryReminders.notify(event);
  }

  @UseGuards(serviceCallGuard('chat'))
  @Post('chat-message')
  @HttpCode(HttpStatus.OK)
  chatMessage(@Body() event: ChatMessageEventDto): Promise<DeliveryReport> {
    return this.chatMessages.notify(event);
  }

  @UseGuards(serviceCallGuard('authentication'))
  @Post('sign-in')
  @HttpCode(HttpStatus.OK)
  signIn(@Body() event: SignInEventDto): Promise<DeliveryReport> {
    return this.signIns.notify(event);
  }

  @UseGuards(serviceCallGuard('chat'))
  @Post('call-ringing')
  @HttpCode(HttpStatus.OK)
  callRinging(@Body() event: CallEventDto): Promise<DeliveryReport> {
    return this.calls.ringing(event);
  }

  @UseGuards(serviceCallGuard('chat'))
  @Post('call-ended')
  @HttpCode(HttpStatus.OK)
  callEnded(@Body() event: CallEndedEventDto): Promise<DeliveryReport> {
    return this.calls.ended(event);
  }

  @UseGuards(serviceCallGuard('property'))
  @Post('saved-search-match')
  @HttpCode(HttpStatus.OK)
  savedSearchMatch(
    @Body() event: SavedSearchMatchEventDto,
  ): Promise<DeliveryReport> {
    return this.listingAlerts.notify(
      'Saved search',
      'savedSearchAlerts',
      event.recipients.map((recipient) => ({
        userId: recipient.userId,
        push: (target) =>
          savedSearchMatchPush(
            {
              propertyId: event.propertyId,
              title: event.title,
              searchName: recipient.searchName,
            },
            target,
          ),
      })),
    );
  }

  @UseGuards(serviceCallGuard('property'))
  @Post('followed-listing')
  @HttpCode(HttpStatus.OK)
  followedListing(
    @Body() event: FollowedListingEventDto,
  ): Promise<DeliveryReport> {
    return this.listingAlerts.notify(
      'Followed listing',
      'followedListings',
      event.recipients.map((userId) => ({
        userId,
        push: (target) => followedListingPush(event, target),
      })),
    );
  }

  @UseGuards(serviceCallGuard('property'))
  @Post('saved-listing-update')
  @HttpCode(HttpStatus.OK)
  savedListingUpdate(
    @Body() event: SavedListingUpdateEventDto,
  ): Promise<DeliveryReport> {
    const push =
      event.kind === 'price_drop'
        ? (target: PushTarget) =>
            priceDropPush(
              { ...event, from: event.from ?? 0, to: event.to ?? 0 },
              target,
            )
        : (target: PushTarget) => soldPush(event, target);
    return this.listingAlerts.notify(
      event.kind === 'price_drop' ? 'Price drop' : 'Sold listing',
      'savedListingUpdates',
      event.recipients.map((userId) => ({ userId, push })),
    );
  }
}
