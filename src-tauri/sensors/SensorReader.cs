// Studio-owned, one-way CPU sensor reader. Uses an existing LibreHardwareMonitor
// installation and existing PawnIO driver; never installs services or drivers.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Pipes;
using System.Reflection;
using System.Security.Cryptography;
using System.Threading;
using System.Web.Script.Serialization;

internal static class SensorReader
{
    private static object Get(object value, string name) { return value.GetType().GetProperty(name).GetValue(value, null); }
    private static void Call(object value, string name) { value.GetType().GetMethod(name, Type.EmptyTypes).Invoke(value, null); }
    private static bool OwnerAlive(int id, long started)
    {
        try { using (Process p = Process.GetProcessById(id)) { return !p.HasExited && p.StartTime.ToUniversalTime().ToFileTimeUtc() == started; } }
        catch { return false; }
    }
    private static void Main(string[] args)
    {
        if (args.Length != 5) return;
        string library = Path.GetFullPath(args[0]), expected = args[1], pipe = args[2];
        int owner; long started;
        if (!int.TryParse(args[3], out owner) || !long.TryParse(args[4], out started)
            || !pipe.StartsWith("zicode-cpu-", StringComparison.Ordinal) || pipe.Length > 80
            || !String.Equals(Path.GetFileName(library), "LibreHardwareMonitorLib.dll", StringComparison.OrdinalIgnoreCase)) return;
        object computer = null;
        try
        {
            using (SHA256 hash = SHA256.Create()) using (FileStream file = File.OpenRead(library))
                if (!String.Equals(BitConverter.ToString(hash.ComputeHash(file)).Replace("-", ""), expected, StringComparison.OrdinalIgnoreCase)) return;
            if (!OwnerAlive(owner, started)) return;
            using (NamedPipeClientStream connection = new NamedPipeClientStream(".", pipe, PipeDirection.Out))
            {
                connection.Connect(10000);
                using (StreamWriter output = new StreamWriter(connection, new System.Text.UTF8Encoding(false)))
                {
                    output.AutoFlush = true;
                    Assembly assembly = Assembly.LoadFrom(library);
                    computer = Activator.CreateInstance(assembly.GetType("LibreHardwareMonitor.Hardware.Computer", true));
                    computer.GetType().GetProperty("IsCpuEnabled").SetValue(computer, true, null);
                    Call(computer, "Open");
                    JavaScriptSerializer json = new JavaScriptSerializer();
                    while (OwnerAlive(owner, started))
                    {
                        List<object> sensors = new List<object>();
                        foreach (object hardware in (IEnumerable)Get(computer, "Hardware"))
                        {
                            if (Get(hardware, "HardwareType").ToString() != "Cpu") continue;
                            Call(hardware, "Update");
                            foreach (object sensor in (IEnumerable)Get(hardware, "Sensors"))
                            {
                                if (Get(sensor, "SensorType").ToString() != "Temperature") continue;
                                object raw = Get(sensor, "Value");
                                if (raw == null) continue;
                                double value = Convert.ToDouble(raw, CultureInfo.InvariantCulture);
                                string name = Get(sensor, "Name").ToString(), identifier = Get(sensor, "Identifier").ToString();
                                if (value <= 0 || value >= 150 || Double.IsNaN(value) || name.Length > 100 || identifier.Length > 160 || sensors.Count >= 64) continue;
                                sensors.Add(new { name = name, identifier = identifier, celsius = value });
                            }
                        }
                        output.WriteLine(json.Serialize(new { sampledAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), sensors = sensors }));
                        Thread.Sleep(2000);
                    }
                }
            }
        }
        catch { /* A disconnected owner, denied sensor or missing dependency ends only this reader. */ }
        finally { if (computer != null) { try { Call(computer, "Close"); } catch { } } }
    }
}

