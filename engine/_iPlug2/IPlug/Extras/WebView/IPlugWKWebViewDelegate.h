 /*
 ==============================================================================
 
  MIT License

  iPlug2 WebView Library
  Copyright (c) 2024 Oliver Larkin

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all
  copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  SOFTWARE.
 
 ==============================================================================
*/

#pragma once

#import <WebKit/WebKit.h>
#import "IPlugWKWebView.h"

// Local build fix: WKDownload only exists in the macOS 11.3+ SDK. Older
// Command Line Tools (e.g. MacOSX11.1.sdk) can still build the WebView
// without the download delegate.
#if __MAC_OS_X_VERSION_MAX_ALLOWED >= 110300
#define IPLUG_HAS_WKDOWNLOAD 1
#else
#define IPLUG_HAS_WKDOWNLOAD 0
#endif

namespace iplug {
class IWebView;
}

@interface IPLUG_WKWEBVIEW_DELEGATE : NSObject <WKNavigationDelegate
#if IPLUG_HAS_WKDOWNLOAD
, WKDownloadDelegate
#endif
>
NS_ASSUME_NONNULL_BEGIN
{
  iplug::IWebView* mIWebView;
  NSURL* _Nullable downloadDestinationURL;
}

- (id)initWithIWebView:(iplug::IWebView*)webView;

- (void)dealloc;

- (void)webView:(WKWebView*)webView decidePolicyForNavigationAction:(WKNavigationAction*)navigationAction 
                                                    decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler;

- (void)webView:(WKWebView*)webView decidePolicyForNavigationResponse:(WKNavigationResponse*)navigationResponse 
                                                      decisionHandler:(void (^)(WKNavigationResponsePolicy))decisionHandler;

- (void)webView:(IPLUG_WKWEBVIEW*)webView didFinishNavigation:(WKNavigation*)navigation;

#pragma mark WKDownloadDelegate

#if IPLUG_HAS_WKDOWNLOAD
- (void)webView:(WKWebView*)webView navigationResponse:(WKNavigationResponse*)navigationResponse 
                                     didBecomeDownload:(WKDownload*)download API_AVAILABLE(macos(11.3), ios(14.5));

- (void)download:(WKDownload*)download decideDestinationUsingResponse:(NSURLResponse*)response 
                                                    suggestedFilename:(NSString*)filename 
                                                    completionHandler:(void (^)(NSURL* _Nullable))completionHandler API_AVAILABLE(macos(11.3), ios(14.5));

- (void)download:(WKDownload*)download didReceiveData:(int64_t)length API_AVAILABLE(macos(11.3), ios(14.5));

- (void)download:(WKDownload*)download didFailWithError:(NSError*)error API_AVAILABLE(macos(11.3), ios(14.5));

- (void)downloadDidFinish:(WKDownload*)download API_AVAILABLE(macos(11.3), ios(14.5));

#endif // IPLUG_HAS_WKDOWNLOAD

NS_ASSUME_NONNULL_END

@end
