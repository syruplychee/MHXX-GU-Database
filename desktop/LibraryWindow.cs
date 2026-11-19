using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class LibraryWindow
{
    private const string Home = "https://mhxx.invalid/";

    internal static async Task Attach(Form window, string runtime, string data)
    {
        CoreWebView2Environment.SetLoaderDllFolderPath(Path.Combine(runtime, "webview2"));
        string browserVersion = CoreWebView2Environment.GetAvailableBrowserVersionString();
        if (string.IsNullOrEmpty(browserVersion))
            throw new InvalidOperationException("请安装 Microsoft Edge WebView2 Runtime，再打开资料库。");

        var start = new ProcessStartInfo(Path.Combine(runtime, "node.exe"), "desktop-server.cjs")
        {
            WorkingDirectory = runtime,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardErrorEncoding = Encoding.UTF8
        };
        start.EnvironmentVariables.Remove("MHXX_DB");
        start.EnvironmentVariables.Remove("NODE_OPTIONS");
        var server = Process.Start(start);
        var http = new HttpClient(new HttpClientHandler { UseProxy = false, AllowAutoRedirect = false });
        window.FormClosed += (sender, args) =>
        {
            http.Dispose();
            if (!server.HasExited)
            {
                server.StandardInput.Close();
                if (!server.WaitForExit(1000)) server.Kill();
            }
            server.Dispose();
        };
        int port;
        if (!int.TryParse(await server.StandardOutput.ReadLineAsync(), out port))
            throw new InvalidOperationException("资料服务启动失败。" + Environment.NewLine + await server.StandardError.ReadToEndAsync());
        if (window.IsDisposed) return;

        var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(data, "Profile"));
        if (window.IsDisposed) return;
        var view = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(11, 13, 18) };
        window.Controls.Add(view);
        view.BringToFront();
        await view.EnsureCoreWebView2Async(env);
        if (window.IsDisposed) return;

        string origin = "http://127.0.0.1:" + port;
        var web = view.CoreWebView2;
        web.AddWebResourceRequestedFilter(Home + "*", CoreWebView2WebResourceContext.All, CoreWebView2WebResourceRequestSourceKinds.All);
        web.WebResourceRequested += async (sender, args) => await Serve(args, env, http, origin);
        web.NavigationStarting += (sender, args) =>
        {
            if (args.Uri.StartsWith(Home, StringComparison.Ordinal)) return;
            args.Cancel = true;
            OpenExternal(args.Uri);
        };
        web.NewWindowRequested += (sender, args) =>
        {
            args.Handled = true;
            if (args.Uri.StartsWith(Home + "icons/", StringComparison.Ordinal))
            {
                var image = new PictureBox { Dock = DockStyle.Fill, SizeMode = PictureBoxSizeMode.Zoom };
                image.LoadAsync(origin + new Uri(args.Uri).PathAndQuery);
                var viewer = new Form { Text = "查看大图", ClientSize = new Size(850, 650), BackColor = window.BackColor };
                viewer.Controls.Add(image);
                viewer.Show(window);
            }
            else OpenExternal(args.Uri);
        };
        web.Navigate(Home);
    }

    private static async Task Serve(CoreWebView2WebResourceRequestedEventArgs args, CoreWebView2Environment env, HttpClient http, string origin)
    {
        using (var deferral = args.GetDeferral())
        {
            try
            {
                var original = args.Request;
                using (var request = new HttpRequestMessage(new HttpMethod(original.Method), origin + new Uri(original.Uri).PathAndQuery))
                {
                    if (original.Content != null)
                    {
                        using (var body = new MemoryStream())
                        {
                            original.Content.CopyTo(body);
                            request.Content = new ByteArrayContent(body.ToArray());
                        }
                        if (original.Headers.Contains("Content-Type"))
                            request.Content.Headers.TryAddWithoutValidation("Content-Type", original.Headers.GetHeader("Content-Type"));
                    }
                    using (var response = await http.SendAsync(request))
                    {
                        byte[] bytes = await response.Content.ReadAsByteArrayAsync();
                        var headers = new StringBuilder();
                        if (response.Content.Headers.ContentType != null)
                            headers.Append("Content-Type: ").Append(response.Content.Headers.ContentType).Append("\r\n");
                        if (response.Headers.CacheControl != null)
                            headers.Append("Cache-Control: ").Append(response.Headers.CacheControl).Append("\r\n");
                        args.Response = env.CreateWebResourceResponse(new MemoryStream(bytes), (int)response.StatusCode, response.ReasonPhrase, headers.ToString());
                    }
                }
            }
            catch (HttpRequestException)
            {
                args.Response = env.CreateWebResourceResponse(null, 502, "Local data service unavailable", "");
            }
        }
    }

    private static void OpenExternal(string address)
    {
        Uri uri;
        if (Uri.TryCreate(address, UriKind.Absolute, out uri) && (uri.Scheme == "https" || uri.Scheme == "http"))
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
    }
}
