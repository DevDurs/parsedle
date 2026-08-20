/**
 * What we actually use out of the Discord SDK.
 *
 * Naming it explicitly keeps the bundle to the parts the Activity needs and
 * makes the dependency surface obvious: two exports, no more.
 */

export { DiscordSDK, patchUrlMappings } from '@discord/embedded-app-sdk';
