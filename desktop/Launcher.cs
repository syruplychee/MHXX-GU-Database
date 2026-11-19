using System;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

[assembly: AssemblyTitle("MHXX资料库")]
[assembly: AssemblyProduct("MHXX资料库")]
[assembly: AssemblyFileVersion("1.0.1.0")]

internal static class Launcher
{
    private const string Product = "MHXX资料库";
    private static readonly Assembly Executable = Assembly.GetExecutingAssembly();

    [STAThread]
    private static void Main()
    {
        bool firstInstance;
        using (var instance = new Mutex(true, "Local\\MHXXLibraryDesktop", out firstInstance))
        {
            if (!firstInstance) return;
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            using (var window = new Form
            {
                Text = Product,
                Size = new Size(1420, 940),
                MinimumSize = new Size(640, 460),
                StartPosition = FormStartPosition.CenterScreen,
                BackColor = Color.FromArgb(11, 13, 18),
                Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath)
            })
            {
                var status = new Label
                {
                    Dock = DockStyle.Fill,
                    TextAlign = ContentAlignment.MiddleCenter,
                    ForeColor = Color.Gainsboro,
                    Text = "正在打开资料库…"
                };
                window.Controls.Add(status);
                window.Shown += async (sender, args) =>
                {
                    try
                    {
                        string data = FindDataFolder();
                        string runtime = await Task.Run(() => ExtractPackage(data));
                        if (window.IsDisposed) return;
                        AppDomain.CurrentDomain.AssemblyResolve += LoadBundledAssembly;
                        await LibraryWindow.Attach(window, runtime, data);
                        status.Dispose();
                    }
                    catch (Exception error)
                    {
                        if (window.IsDisposed) return;
                        MessageBox.Show(window, error.Message, "无法打开 MHXX资料库", MessageBoxButtons.OK, MessageBoxIcon.Error);
                        window.Close();
                    }
                };
                Application.Run(window);
            }
        }
    }

    private static Assembly LoadBundledAssembly(object source, ResolveEventArgs request)
    {
        string name = new AssemblyName(request.Name).Name;
        if (name != "Microsoft.Web.WebView2.Core" && name != "Microsoft.Web.WebView2.WinForms") return null;
        using (Stream resource = Executable.GetManifestResourceStream(name + ".dll"))
        using (var bytes = new MemoryStream())
        {
            resource.CopyTo(bytes);
            return Assembly.Load(bytes.ToArray());
        }
    }

    private static string FindDataFolder()
    {
        string besideExe = Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), Product + "-data");
        string userFolder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Product);
        foreach (string folder in new[] { besideExe, userFolder })
        {
            try
            {
                foreach (string name in new[] { "Runtime", "Profile" })
                {
                    string subfolder = Directory.CreateDirectory(Path.Combine(folder, name)).FullName;
                    string probe = Path.Combine(subfolder, Guid.NewGuid().ToString("N") + ".tmp");
                    using (File.Create(probe, 4096, FileOptions.DeleteOnClose)) { }
                }
                return folder;
            }
            catch (UnauthorizedAccessException) { }
            catch (IOException) { }
        }
        throw new IOException("无法写入资料库的数据目录。请把 EXE 移到有写入权限的文件夹后重新打开。" +
            Environment.NewLine + besideExe + Environment.NewLine + userFolder);
    }

    private static string ExtractPackage(string data)
    {
        using (Stream package = Executable.GetManifestResourceStream("mhxx-package.zip"))
        using (var sha = SHA256.Create())
        {
            string version = BitConverter.ToString(sha.ComputeHash(package)).Replace("-", "").Substring(0, 24);
            string parent = Path.Combine(data, "Runtime");
            string runtime = Path.Combine(parent, version);
            if (Directory.Exists(runtime)) return runtime;
            Directory.CreateDirectory(parent);
            string staging = runtime + ".unpacking-" + Guid.NewGuid().ToString("N");
            try
            {
                package.Position = 0;
                using (var zip = new ZipArchive(package, ZipArchiveMode.Read, true))
                    zip.ExtractToDirectory(staging);
                Directory.Move(staging, runtime);
                return runtime;
            }
            finally
            {
                if (Directory.Exists(staging)) Directory.Delete(staging, true);
            }
        }
    }
}
